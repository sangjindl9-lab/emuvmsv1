/**
 * 제한된 수식 평가기 (sandbox).
 * 임의 스크립트 실행(eval/Function)을 쓰지 않고, 숫자·변수·사칙연산·괄호만 허용한다.
 * 예: "raw * 0.1 + offset", "(raw - 4) * 20", "min(raw, 100)"
 */
type Token = { type: "num" | "ident" | "op" | "lp" | "rp" | "comma"; value: string };

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  min: Math.min,
  max: Math.max,
  abs: Math.abs,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  sqrt: Math.sqrt,
};

export function evaluateExpression(expression: string, variables: Record<string, number>): number {
  const tokens = tokenize(expression);
  let pos = 0;

  function peek(): Token | undefined {
    return tokens[pos];
  }
  function next(): Token {
    const token = tokens[pos++];
    if (!token) throw new Error("수식이 예상보다 일찍 끝났습니다.");
    return token;
  }

  function parseExpression(): number {
    let value = parseTerm();
    while (peek()?.type === "op" && (peek()!.value === "+" || peek()!.value === "-")) {
      const op = next().value;
      const rhs = parseTerm();
      value = op === "+" ? value + rhs : value - rhs;
    }
    return value;
  }

  function parseTerm(): number {
    let value = parseUnary();
    while (peek()?.type === "op" && (peek()!.value === "*" || peek()!.value === "/" || peek()!.value === "%")) {
      const op = next().value;
      const rhs = parseUnary();
      if ((op === "/" || op === "%") && rhs === 0) throw new Error("0으로 나눌 수 없습니다.");
      value = op === "*" ? value * rhs : op === "/" ? value / rhs : value % rhs;
    }
    return value;
  }

  function parseUnary(): number {
    if (peek()?.type === "op" && (peek()!.value === "-" || peek()!.value === "+")) {
      const op = next().value;
      const v = parseUnary();
      return op === "-" ? -v : v;
    }
    return parsePrimary();
  }

  function parsePrimary(): number {
    const token = peek();
    if (!token) throw new Error("수식 오류");
    if (token.type === "num") {
      next();
      return Number(token.value);
    }
    if (token.type === "lp") {
      next();
      const v = parseExpression();
      if (next().type !== "rp") throw new Error("괄호가 닫히지 않았습니다.");
      return v;
    }
    if (token.type === "ident") {
      next();
      if (peek()?.type === "lp") {
        const fn = FUNCTIONS[token.value.toLowerCase()];
        if (!fn) throw new Error(`허용되지 않은 함수: ${token.value}`);
        next();
        const args: number[] = [];
        if (peek()?.type !== "rp") {
          args.push(parseExpression());
          while (peek()?.type === "comma") {
            next();
            args.push(parseExpression());
          }
        }
        if (next().type !== "rp") throw new Error("함수 괄호 오류");
        return fn(...args);
      }
      const value = variables[token.value];
      if (value === undefined) throw new Error(`알 수 없는 변수: ${token.value}`);
      return value;
    }
    throw new Error(`예상하지 못한 토큰: ${token.value}`);
  }

  const result = parseExpression();
  if (pos !== tokens.length) throw new Error("수식 뒤에 남는 문자가 있습니다.");
  if (!Number.isFinite(result)) throw new Error("수식 결과가 유한수가 아닙니다.");
  return result;
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let num = "";
      while (i < input.length && /[0-9.eE]/.test(input[i])) num += input[i++];
      if (!/^[0-9.]+(?:[eE][+-]?[0-9]+)?$/.test(num)) throw new Error(`숫자 형식 오류: ${num}`);
      tokens.push({ type: "num", value: num });
      continue;
    }
    if (/[A-Za-z가-힣_]/.test(ch)) {
      let id = "";
      while (i < input.length && /[A-Za-z0-9_가-힣.]/.test(input[i])) id += input[i++];
      tokens.push({ type: "ident", value: id });
      continue;
    }
    if ("+-*/%".includes(ch)) {
      tokens.push({ type: "op", value: ch });
      i++;
      continue;
    }
    if (ch === "(") {
      tokens.push({ type: "lp", value: ch });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ type: "rp", value: ch });
      i++;
      continue;
    }
    if (ch === ",") {
      tokens.push({ type: "comma", value: ch });
      i++;
      continue;
    }
    throw new Error(`허용되지 않은 문자: ${ch}`);
  }
  return tokens;
}
