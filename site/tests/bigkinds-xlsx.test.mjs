import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import { parseBigKindsXlsx } from "../lib/bigkinds-xlsx.mjs";

test("reads real worksheet cells even when the exported dimension incorrectly says A1", () => {
  const workbook = zipSync({
    "xl/sharedStrings.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
      <sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <si><t>뉴스 식별자</t></si><si><t>언론사</t></si><si><t>제목</t></si>
        <si><t>BIG.20260726010101</t></si><si><t>한겨레</t></si><si><t>검증 기사</t></si>
      </sst>`),
    "xl/worksheets/sheet1.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
      <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <dimension ref="A1"/>
        <sheetData>
          <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>
          <row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2" t="s"><v>4</v></c><c r="C2" t="s"><v>5</v></c></row>
        </sheetData>
      </worksheet>`),
  });
  const rows = parseBigKindsXlsx(workbook);
  assert.deepEqual(rows, [
    ["뉴스 식별자", "언론사", "제목"],
    ["BIG.20260726010101", "한겨레", "검증 기사"],
  ]);
});
