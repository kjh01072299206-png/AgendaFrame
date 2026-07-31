import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import { isBigKindsExcludedValue, parseBigKindsXlsx } from "../lib/bigkinds-xlsx.mjs";

test("treats only explicit exclusion markers as excluded", () => {
  assert.equal(isBigKindsExcludedValue("예외"), true);
  assert.equal(isBigKindsExcludedValue("제외"), true);
  assert.equal(isBigKindsExcludedValue("본문 확보"), false);
  assert.equal(isBigKindsExcludedValue(""), false);
  assert.equal(isBigKindsExcludedValue(null), false);
});

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

test("reads namespace-prefixed worksheet XML emitted by some Excel exports", () => {
  const workbook = zipSync({
    "xl/sharedStrings.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
      <x:sst xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <x:si><x:t>뉴스 식별자</x:t></x:si><x:si><x:t>본문</x:t></x:si>
      </x:sst>`),
    "xl/worksheets/sheet1.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
      <x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <x:sheetData>
          <x:row r="1"><x:c r="A1" t="s"><x:v>0</x:v></x:c><x:c r="B1" t="s"><x:v>1</x:v></x:c></x:row>
          <x:row r="2"><x:c r="A2" t="inlineStr"><x:is><x:t>NEWS.20260726010101</x:t></x:is></x:c><x:c r="B2" t="inlineStr"><x:is><x:t>본문 확보</x:t></x:is></x:c></x:row>
        </x:sheetData>
      </x:worksheet>`),
  });
  const rows = parseBigKindsXlsx(workbook);
  assert.deepEqual(rows, [
    ["뉴스 식별자", "본문"],
    ["NEWS.20260726010101", "본문 확보"],
  ]);
});
