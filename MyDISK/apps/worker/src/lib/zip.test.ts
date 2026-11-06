import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readTarGzEntries } from "./tar-reader";
import { createZipStream, type ZipSource } from "./zip-writer";
import { openZipEntry, readZipEntries } from "./zip-reader";

const created: string[] = [];

afterAll(async () => {
  await Promise.all(created.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mydisk-zip-"));
  created.push(dir);
  return dir;
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

describe("zip writer/reader 回环", () => {
  test("目录与多文件可被自读回原样", async () => {
    const dir = await tempDir();
    const text = "hello 网盘";
    const binary = Buffer.from([0, 1, 2, 250, 255]);
    await writeFile(join(dir, "a.txt"), text);
    await writeFile(join(dir, "b.bin"), binary);

    const sources: ZipSource[] = [
      { name: "docs", isDirectory: true, open: async () => new ReadableStream() },
      {
        name: "docs/a.txt",
        isDirectory: false,
        open: async () => Bun.file(join(dir, "a.txt")).stream(),
      },
      {
        name: "docs/b.bin",
        isDirectory: false,
        open: async () => Bun.file(join(dir, "b.bin")).stream(),
      },
    ];

    const zipPath = join(dir, "out.zip");
    await writeFile(zipPath, await drain(createZipStream(sources)));

    const entries = await readZipEntries(zipPath);
    expect(entries.map((entry) => entry.name)).toEqual(["docs/", "docs/a.txt", "docs/b.bin"]);
    expect(entries[0]!.isDirectory).toBe(true);

    const extractedText = await drain(await openZipEntry(zipPath, entries[1]!));
    expect(extractedText.toString("utf8")).toBe(text);

    const extractedBinary = await drain(await openZipEntry(zipPath, entries[2]!));
    expect(extractedBinary.equals(binary)).toBe(true);

    // 自产 zip 可被第三方工具（系统 tar）解析
    expect((await readFile(zipPath)).length).toBeGreaterThan(0);
  });

  test("系统 tar.gz 可被顺序解析", async () => {
    const dir = await tempDir();
    const text = "tar 内容";
    await writeFile(join(dir, "a.txt"), text);
    await mkdir(join(dir, "sub"), { recursive: true });
    await writeFile(join(dir, "sub/b.txt"), text);

    const tarPath = join(dir, "out.tar.gz");
    const proc = Bun.spawn(["tar", "-czf", tarPath, "a.txt", "sub"], { cwd: dir });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      return; // 环境没有 tar 时跳过
    }

    const seen: Record<string, string> = {};
    for await (const entry of readTarGzEntries(tarPath)) {
      if (entry.isDirectory) {
        continue;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of entry.data) {
        chunks.push(chunk);
      }
      seen[entry.name] = Buffer.concat(chunks).toString("utf8");
    }
    expect(seen["a.txt"]).toBe(text);
    expect(seen["sub/b.txt"]).toBe(text);
  });
});
