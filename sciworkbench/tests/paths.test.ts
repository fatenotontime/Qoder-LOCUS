import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pathOfRole,
  artifactsOfPath,
  eventOfOperation,
  producesUserExecution,
  createsUserSample,
  claimsUserOriginal,
} from "../domain/paths.ts";

test("三条路径各自不同，不共用入口", () => {
  assert.equal(pathOfRole("literature"), "lit");
  assert.equal(pathOfRole("protocol"), "protocol");
  assert.equal(pathOfRole("experimental_data"), "data");
});

test("文献路径产证据卡，不产执行/测量", () => {
  const { produces } = artifactsOfPath("lit");
  assert.ok(produces.includes("EvidenceCard"));
  assert.ok(!produces.includes("Execution"));
  assert.ok(!produces.includes("Measurement"));
});

test("数据路径产测量与执行", () => {
  const { produces } = artifactsOfPath("data");
  assert.ok(produces.includes("Measurement"));
  assert.ok(produces.includes("Execution"));
});

test("两个事件：导入公开数据 ≠ 用户执行实验", () => {
  assert.equal(eventOfOperation("import_public_data"), "public_import");
  assert.equal(eventOfOperation("run_experiment"), "user_execution");
});

test("导入公开数据不产生用户执行/样品，也不宣称用户原创", () => {
  assert.equal(producesUserExecution("import_public_data"), false);
  assert.equal(createsUserSample("import_public_data"), false);
  assert.equal(claimsUserOriginal("import_public_data"), false);
});

test("用户执行实验产生执行与样品，可宣称用户原创", () => {
  assert.equal(producesUserExecution("run_experiment"), true);
  assert.equal(createsUserSample("run_experiment"), true);
  assert.equal(claimsUserOriginal("run_experiment"), true);
});
