import { inflateRawSync, inflateSync } from "node:zlib";

/**
 * 제조사 매뉴얼 텍스트 추출 (방식 2).
 * 외부 유료 API/바이너리 없이 표준 라이브러리만 사용한다.
 * 한계(문서화됨):
 *  - 스캔 이미지 PDF는 OCR 미지원
 *  - CID 폰트로 인코딩된 한글 PDF는 텍스트가 깨질 수 있음
 *  - 암호가 걸린 ZIP/PDF는 열지 않음
 *  - XLSX는 첫 시트 중심, 수식 결과값은 캐시된 값만 사용
 */
export type ExtractedDocument = {
  docType: string;
  text: string;
  tables: string[][];
  pages: number;
  notes: string[];
};

type ZipEntry = { name: string; data: Buffer };

export function readZip(buffer: Buffer): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0 && i > buffer.length - 66000; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("ZIP 중앙 디렉터리를 찾을 수 없습니다 (암호화되었거나 ZIP이 아님).");
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if (buffer.readUInt32LE(localOffset) === 0x04034b50) {
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const raw = buffer.subarray(dataStart, dataStart + compressedSize);
      if (!name.endsWith("/")) {
        try {
          if (method === 0) entries.push({ name, data: Buffer.from(raw) });
          else if (method === 8) entries.push({ name, data: inflateRawSync(raw) });
        } catch {
          // 손상된 엔트리는 건너뛴다.
        }
      }
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function stripXml(xml: string): string {
  return xml
    .replace(/<w:p[ >]/g, "\n<w:p ")
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<w:br\/>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function extractDocx(buffer: Buffer): ExtractedDocument {
  const entries = readZip(buffer);
  const doc = entries.find((e) => e.name === "word/document.xml");
  if (!doc) throw new Error("DOCX 본문(word/document.xml)을 찾을 수 없습니다.");
  const text = stripXml(doc.data.toString("utf8"));
  const tables: string[][] = [];
  return { docType: "DOCX", text, tables, pages: 0, notes: ["DOCX 텍스트 추출 완료"] };
}

function columnIndex(ref: string): number {
  const letters = ref.replace(/[0-9]/g, "");
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function extractXlsx(buffer: Buffer): ExtractedDocument {
  const entries = readZip(buffer);
  const sharedEntry = entries.find((e) => e.name === "xl/sharedStrings.xml");
  const shared: string[] = [];
  if (sharedEntry) {
    const xml = sharedEntry.data.toString("utf8");
    for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(stripXml(m[1]));
  }
  const sheet = entries.find((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name));
  if (!sheet) throw new Error("XLSX 워크시트를 찾을 수 없습니다.");
  const xml = sheet.data.toString("utf8");
  const rows: string[][] = [];
  for (const rowMatch of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1];
      const body = cellMatch[2];
      const ref = /r="([A-Z]+)\d+"/.exec(attrs)?.[1] ?? "";
      const type = /t="([^"]+)"/.exec(attrs)?.[1];
      let value = "";
      if (type === "s") {
        const idx = Number(/<v>(\d+)<\/v>/.exec(body)?.[1] ?? "-1");
        value = shared[idx] ?? "";
      } else if (type === "inlineStr") {
        value = stripXml(/<is>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? "");
      } else {
        value = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "";
      }
      if (ref) cells[columnIndex(ref)] = value.trim();
    }
    if (cells.some((c) => c && c.length > 0)) rows.push(cells.map((c) => c ?? ""));
  }
  const text = rows.map((r) => r.join("\t")).join("\n");
  return { docType: "XLSX", text, tables: rows, pages: 0, notes: [`XLSX 시트 1개, ${rows.length}행 추출`] };
}

function decodePdfString(raw: string): string {
  const hex = /^<([0-9A-Fa-f\s]+)>$/.exec(raw.trim());
  if (hex) {
    const clean = hex[1].replace(/\s/g, "");
    let out = "";
    for (let i = 0; i + 1 < clean.length; i += 2) {
      const code = parseInt(clean.slice(i, i + 2), 16);
      if (code >= 32 && code < 127) out += String.fromCharCode(code);
    }
    return out;
  }
  const content = raw.replace(/^\(/, "").replace(/\)$/, "");
  return content
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\([()\\])/g, "$1")
    .replace(/\\(\d{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
}

export function extractPdf(buffer: Buffer): ExtractedDocument {
  const binary = buffer.toString("latin1");
  const notes: string[] = [];
  const texts: string[] = [];
  let pages = 0;
  const objects = binary.matchAll(/(\d+)\s+0\s+obj([\s\S]*?)endobj/g);
  for (const obj of objects) {
    const body = obj[2];
    if (/\/Type\s*\/Page[^s]/.test(body)) pages += 1;
    const streamMatch = /stream\r?\n([\s\S]*?)\r?\nendstream/.exec(body);
    if (!streamMatch) continue;
    const isFlate = /\/Filter\s*\/FlateDecode/.test(body);
    let content = streamMatch[1];
    if (isFlate) {
      try {
        content = inflateSync(Buffer.from(streamMatch[1], "latin1")).toString("latin1");
      } catch {
        try {
          content = inflateRawSync(Buffer.from(streamMatch[1], "latin1")).toString("latin1");
        } catch {
          continue;
        }
      }
    }
    if (!/BT[\s\S]*ET/.test(content)) continue;
    let pageText = "";
    for (const block of content.matchAll(/BT([\s\S]*?)ET/g)) {
      const inner = block[1];
      for (const op of inner.matchAll(/(\[(?:[\s\S]*?)\]|\((?:\\.|[^\\])*?\)|<[0-9A-Fa-f\s]+>)\s*T[Jj]/g)) {
        const arg = op[1];
        if (arg.startsWith("[")) {
          for (const piece of arg.matchAll(/\((?:\\.|[^\\])*?\)|<[0-9A-Fa-f\s]+>/g)) {
            pageText += decodePdfString(piece[0]);
          }
        } else {
          pageText += decodePdfString(arg);
        }
        pageText += " ";
      }
      pageText += "\n";
    }
    if (pageText.trim()) texts.push(pageText);
  }
  if (texts.length === 0) {
    notes.push("텍스트 스트림을 찾지 못했습니다. 스캔 이미지 PDF이거나 CID 폰트 인코딩일 수 있습니다(OCR 미지원).");
  } else {
    notes.push(`텍스트 기반 PDF ${texts.length}개 스트림 추출`);
  }
  return { docType: "PDF", text: texts.join("\n"), tables: [], pages, notes };
}

export function extractZip(buffer: Buffer): ExtractedDocument {
  const entries = readZip(buffer);
  const notes: string[] = [];
  let text = "";
  const tables: string[][] = [];
  for (const entry of entries) {
    try {
      if (/\.(txt|csv|json|xml|md)$/i.test(entry.name)) {
        text += `\n# ${entry.name}\n${entry.data.toString("utf8")}\n`;
        if (/\.csv$/i.test(entry.name)) tables.push(...parseCsv(entry.data.toString("utf8")));
      } else if (/\.pdf$/i.test(entry.name)) {
        const pdf = extractPdf(entry.data);
        text += `\n# ${entry.name}\n${pdf.text}\n`;
        notes.push(...pdf.notes);
      } else if (/\.docx$/i.test(entry.name)) {
        text += `\n# ${entry.name}\n${extractDocx(entry.data).text}\n`;
      } else if (/\.xlsx$/i.test(entry.name)) {
        const xlsx = extractXlsx(entry.data);
        text += `\n# ${entry.name}\n${xlsx.text}\n`;
        tables.push(...xlsx.tables);
      }
    } catch (error) {
      notes.push(`${entry.name}: ${(error as Error).message}`);
    }
  }
  if (!text) throw new Error("ZIP 안에서 분석 가능한 문서를 찾지 못했습니다.");
  notes.push(`ZIP 엔트리 ${entries.length}개 중 지원 형식 추출`);
  return { docType: "ZIP", text, tables, pages: 0, notes };
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const clean = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === "," || ch === "\t" || ch === ";") {
      row.push(field.trim());
      field = "";
    } else if (ch === "\n") {
      row.push(field.replace(/\r$/, "").trim());
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, "").trim());
    if (row.some((cell) => cell.length > 0)) rows.push(row);
  }
  return rows;
}

export function extractDocument(fileName: string, buffer: Buffer): ExtractedDocument {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "pdf":
      return extractPdf(buffer);
    case "docx":
      return extractDocx(buffer);
    case "xlsx":
      return extractXlsx(buffer);
    case "csv": {
      const text = buffer.toString("utf8");
      return { docType: "CSV", text, tables: parseCsv(text), pages: 0, notes: ["CSV 파싱 완료"] };
    }
    case "json": {
      const text = buffer.toString("utf8");
      const notes: string[] = ["JSON 파싱 완료"];
      try {
        JSON.parse(text);
      } catch {
        notes.push("유효한 JSON이 아닙니다. 원문 텍스트로만 사용합니다.");
      }
      return { docType: "JSON", text, tables: [], pages: 0, notes };
    }
    case "xml": {
      const text = stripXml(buffer.toString("utf8"));
      return { docType: "XML", text, tables: [], pages: 0, notes: ["XML 태그 제거 후 텍스트 추출"] };
    }
    case "txt":
    case "md": {
      const utf8 = buffer.toString("utf8");
      const replaced = utf8.includes("\uFFFD") ? buffer.toString("latin1") : utf8;
      return { docType: "TXT", text: replaced, tables: [], pages: 0, notes: ["텍스트 추출 완료"] };
    }
    case "zip":
      return extractZip(buffer);
    default:
      throw new Error(`지원하지 않는 파일 형식입니다: .${ext}`);
  }
}
