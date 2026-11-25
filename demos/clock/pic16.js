// A small PIC16F877A: an assembler for the subset of MPASM the clock's main.asm uses,
// and a cycle-counting core. It runs the original, unmodified source file.

const SYMBOLS = {
  W: 0, F: 1, STATUS: 0x03, PORTB: 0x06, PORTC: 0x07, PORTD: 0x08, INTCON: 0x0b,
  TRISB: 0x86, TRISC: 0x87, TRISD: 0x88, RP0: 5,
  RB0: 0, RB1: 1, RB2: 2, RB3: 3, RB4: 4, RB5: 5, RB6: 6, RB7: 7,
};

const FILE_OPS = new Set(["addwf", "subwf", "movf", "incf", "decfsz", "swapf", "rlf", "rrf"]);
const BIT_OPS = new Set(["bcf", "bsf", "btfsc", "btfss"]);
const JUMP_OPS = new Set(["goto", "call"]);
const OTHER_OPS = new Set(["movwf", "clrf", "movlw", "return", "retfie"]);
const isOp = (t) => FILE_OPS.has(t) || BIT_OPS.has(t) || JUMP_OPS.has(t) || OTHER_OPS.has(t);

function literal(text) {
  const m = /^([dhb])'([0-9a-f]+)'$/i.exec(text);
  if (m) return parseInt(m[2], { d: 10, h: 16, b: 2 }[m[1].toLowerCase()]);
  // MPASM's default radix is hex; the source only uses bare digits 0-7 and `$ + n`.
  return /^[0-9]$/.test(text) ? Number(text) : undefined;
}

export function assemble(source) {
  const symbols = { ...SYMBOLS };
  const lines = [];
  let pc = 0;

  // Pass 1: labels, equates and addresses.
  for (const [index, rawLine] of source.split(/\r?\n/).entries()) {
    const code = rawLine.replace(/;.*/, "").trim();
    if (!code) continue;
    let [head, ...rest] = code.split(/\s+/);
    let op = head.toLowerCase();
    if (op === "list" || op === "#include" || op === "__config") continue;
    if (op === "end") break;
    if (op === "org") { pc = Number(rest[0]); continue; }
    if (rest[0] && rest[0].toLowerCase() === "equ") { symbols[head] = literal(rest[1]); continue; }
    if (!isOp(op)) {
      symbols[head] = pc;
      if (!rest.length) continue;
      [head, ...rest] = rest;
      op = head.toLowerCase();
    }
    if (!isOp(op)) throw new Error(`line ${index + 1}: unknown instruction "${head}"`);
    const operands = rest.join(" ").split(",").map((s) => s.trim()).filter(Boolean);
    lines.push({ pc, op, operands, line: index + 1 });
    pc += 1;
  }

  // Pass 2: operands.
  const program = [];
  for (const { pc: at, op, operands, line } of lines) {
    const value = (text) => {
      const rel = /^\$\s*([+-])\s*(\d+)$/.exec(text);
      if (rel) return at + (rel[1] === "+" ? 1 : -1) * Number(rel[2]);
      const n = literal(text);
      if (n !== undefined) return n;
      if (text in symbols) return symbols[text];
      throw new Error(`line ${line}: unknown symbol "${text}"`);
    };
    program[at] = {
      op, line,
      a: operands.length > 0 ? value(operands[0]) : 0,
      // Byte operations write back to the file register unless told otherwise.
      b: operands.length > 1 ? value(operands[1]) : 1,
    };
  }
  return program;
}

const SHARED = new Set([0x02, 0x03, 0x04, 0x0a, 0x0b]);
const STATUS = 0x03, PORTB = 0x06, INTCON = 0x0b, TRISB = 0x86;

export class Pic16 {
  constructor(program) {
    this.program = program;
    this.reset();
  }

  reset() {
    this.ram = new Uint8Array(512);
    this.ram[STATUS] = 0x18;
    this.ram.fill(0xff, TRISB, TRISB + 3);
    this.w = 0;
    this.pc = 0;
    this.stack = new Uint16Array(8);
    this.sp = 0;
    this.cycles = 0;
    this.inputs = 0;   // levels on the PORTB pins
  }

  address(f) {
    const low = f & 0x7f;
    if (SHARED.has(low) || low >= 0x70) return low;
    return ((this.ram[STATUS] & 0x60) << 2) | low;
  }

  read(f) {
    const at = this.address(f);
    if (at !== PORTB) return this.ram[at];
    const tris = this.ram[TRISB];
    return (this.inputs & tris) | (this.ram[PORTB] & ~tris & 0xff);
  }

  write(f, value) { this.ram[this.address(f)] = value & 0xff; }

  flag(bit, on) {
    if (on) this.ram[STATUS] |= 1 << bit;
    else this.ram[STATUS] &= ~(1 << bit);
  }

  // Drives a PORTB pin. A rising edge on RB0 sets INTF (INTEDG is 1 after reset).
  setPin(bit, high) {
    const before = this.inputs;
    if (high) this.inputs |= 1 << bit;
    else this.inputs &= ~(1 << bit);
    if (bit === 0 && high && !(before & 1)) this.ram[INTCON] |= 0x02;
  }

  push(pc) { this.stack[this.sp] = pc; this.sp = (this.sp + 1) & 7; }
  pop() { this.sp = (this.sp + 7) & 7; return this.stack[this.sp]; }

  run(cycles) {
    const end = this.cycles + cycles;
    while (this.cycles < end) this.step(end);
  }

  step(limit) {
    if ((this.ram[INTCON] & 0x92) === 0x92) {   // GIE, INTE and INTF
      this.ram[INTCON] &= 0x7f;
      this.push(this.pc);
      this.pc = 4;
      this.cycles += 2;
    }

    const ins = this.program[this.pc];
    if (!ins) throw new Error(`no instruction at ${this.pc}`);
    const { op, a, b } = ins;
    this.pc += 1;
    this.cycles += 1;

    switch (op) {
      case "movlw": this.w = a; return;
      case "movwf": this.write(a, this.w); return;
      case "clrf": this.write(a, 0); this.flag(2, true); return;
      case "goto": this.pc = a; this.cycles += 1; return;
      case "call": this.push(this.pc); this.pc = a; this.cycles += 1; return;
      case "return": this.pc = this.pop(); this.cycles += 1; return;
      case "retfie": this.pc = this.pop(); this.ram[INTCON] |= 0x80; this.cycles += 1; return;
      case "bsf": this.write(a, this.read(a) | (1 << b)); return;
      case "bcf": this.write(a, this.read(a) & ~(1 << b)); return;
      case "btfsc": if (!(this.read(a) & (1 << b))) this.skip(); return;
      case "btfss": if (this.read(a) & (1 << b)) this.skip(); return;
    }

    const value = this.read(a);
    let result;
    switch (op) {
      case "movf": result = value; this.flag(2, result === 0); break;
      case "incf": result = (value + 1) & 0xff; this.flag(2, result === 0); break;
      case "swapf": result = ((value << 4) | (value >> 4)) & 0xff; break;
      case "addwf":
        result = value + this.w;
        this.flag(0, result > 0xff); result &= 0xff; this.flag(2, result === 0); break;
      case "subwf":
        result = value - this.w;
        this.flag(0, result >= 0); result &= 0xff; this.flag(2, result === 0); break;
      case "rlf": {
        const carry = this.ram[STATUS] & 1;
        result = ((value << 1) | carry) & 0xff; this.flag(0, value & 0x80); break;
      }
      case "rrf": {
        const carry = this.ram[STATUS] & 1;
        result = (value >> 1) | (carry << 7); this.flag(0, value & 1); break;
      }
      case "decfsz": {
        // `decfsz X,F / goto $-1` only burns time, so take the whole loop in one step.
        const next = this.program[this.pc];
        if (b === 1 && next && next.op === "goto" && next.a === this.pc - 1) {
          const turns = value === 0 ? 256 : value;
          const room = Math.max(1, Math.floor((limit - this.cycles) / 3));
          if (turns <= room) {
            this.cycles += (turns - 1) * 3 + 1;
            this.write(a, 0);
            this.pc += 1;
          } else {
            this.cycles += room * 3 - 1;
            this.write(a, turns - room);
            this.pc -= 1;
          }
          return;
        }
        result = (value - 1) & 0xff;
        if (b === 1) this.write(a, result); else this.w = result;
        if (result === 0) this.skip();
        return;
      }
      default: throw new Error(op);
    }
    if (b === 1) this.write(a, result); else this.w = result;
  }

  skip() { this.pc += 1; this.cycles += 1; }
}

export const CYCLES_PER_SECOND = 20_000_000 / 4;

// HH:MM as the four 74LS47 decoders see it, plus the seconds LED.
export function outputs(cpu) {
  const c = cpu.ram[0x07], d = cpu.ram[0x08];
  return { digits: [d >> 4, d & 15, c >> 4, c & 15], led: Boolean(cpu.ram[PORTB] & 0x20) };
}
