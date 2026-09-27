/**
 * IndexedDB 持久化往返测试（fake-indexeddb，纯本地）。
 */

import { describe, expect, it, beforeEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { createEmptyDoc } from "../src/model/types";

// 每个测试前重置全局 indexedDB
beforeEach(() => {
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
});

import { saveProject, loadProject, listProjects, deleteProject } from "../src/db/idb";

describe("IndexedDB 工程持久化", () => {
  it("保存 → 载入 往返一致", async () => {
    const doc = createEmptyDoc();
    doc.id = "p1";
    doc.name = "测试工程";
    doc.title = "Round Trip 2026";
    doc.body = "Order 123 code A1B2.";
    doc.diagram.caption = "Figure 1";
    doc.diagram.dots[0] = 1;
    await saveProject(doc);

    const loaded = await loadProject("p1");
    expect(loaded).toBeTruthy();
    expect(loaded!.name).toBe("测试工程");
    expect(loaded!.title).toBe("Round Trip 2026");
    expect(loaded!.body).toBe("Order 123 code A1B2.");
    expect(loaded!.diagram.dots[0]).toBe(1);
    expect(loaded!.settings.cellsPerLine).toBe(doc.settings.cellsPerLine);
  });

  it("列表与删除", async () => {
    const a = createEmptyDoc();
    a.id = "a";
    a.name = "A";
    const b = createEmptyDoc();
    b.id = "b";
    b.name = "B";
    await saveProject(a);
    await saveProject(b);

    const list = await listProjects();
    expect(list.map((p) => p.id).sort()).toEqual(["a", "b"]);

    await deleteProject("a");
    const after = await listProjects();
    expect(after.map((p) => p.id)).toEqual(["b"]);
    expect(await loadProject("a")).toBeUndefined();
  });
});
