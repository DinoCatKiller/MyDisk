import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { S3Client, CreateBucketCommand } from "@aws-sdk/client-s3";
import {
  createStorageDriver,
  DEFAULT_LOCAL_ROOT,
  LocalStorageDriver,
  S3Driver,
  type StorageDriver,
} from "../src";

const S3_ENDPOINT = process.env.S3_TEST_ENDPOINT ?? "http://127.0.0.1:9000";
const S3_CONFIGURED = process.env.S3_TEST_SKIP !== "1";
/** s3rver 3.7.1 缺 ListParts / 带 Delimiter 的 Prefix；真 S3 / MinIO 置 0 关闭这些豁免 */
const IS_S3RVER = process.env.S3_TEST_S3RVER !== "0";

/** 云 SDK 需要真实网络栈，用环境开关控制；本地用例始终执行 */
const describeS3 = S3_CONFIGURED ? describe : describe.skip;

function bufferOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

async function readAllText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

type ContractCaps = {
  /** s3rver 3.7.1 忽略带 Delimiter 的 Prefix（真 S3/MinIO 无此问题），默认 true */
  listDelimiterWorks?: boolean;
};

/** 本地驱动与云驱动共用的契约用例（`A4` §1） */
async function exerciseDriverContract(
  driver: StorageDriver,
  prefix: string,
  caps: ContractCaps = {},
): Promise<void> {
  const { listDelimiterWorks = true } = caps;
  const k = (name: string) => `${prefix}/${name}`;

  // put / head / get
  await driver.put(k("a.txt"), bufferOf("hello mydisk"), { contentType: "text/plain" });
  const stat = await driver.head(k("a.txt"));
  expect(stat).not.toBeNull();
  expect(stat!.size).toBe(12);
  expect(await readAllText(await driver.get(k("a.txt")))).toBe("hello mydisk");

  // Range 读取
  const ranged = await readAllText(await driver.get(k("a.txt"), { start: 6 }));
  expect(ranged).toBe("mydisk");

  // copy / list / readAll
  await driver.copy(k("a.txt"), k("b.txt"));
  if (listDelimiterWorks) {
    const listed = await driver.list(prefix);
    expect(listed.some((item) => item.key === k("b.txt"))).toBe(true);
  }
  expect(new TextDecoder().decode(await driver.readAll(k("b.txt")))).toBe("hello mydisk");

  // delete / deleteMany
  await driver.delete(k("a.txt"));
  await driver.deleteMany([k("b.txt"), k("不存在.txt")]);
  expect(await driver.head(k("a.txt"))).toBeNull();

  // 不存在的键
  expect(await driver.head(`${prefix}/nope.bin`)).toBeNull();
  await expect(driver.get(`${prefix}/nope.bin`)).rejects.toThrow();
}

describe("LocalStorageDriver（本地驱动回归）", () => {
  let root: string;
  let driver: LocalStorageDriver;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "mydisk-storage-"));
    driver = new LocalStorageDriver({ root, connectionId: "test-conn" });
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("契约用例", async () => {
    await exerciseDriverContract(driver, "c1/2026/10");
  });

  test("multipart 生命周期（临时目录 + 合并，etag 为完整 sha256）", async () => {
    const multipart = driver.multipart!;
    const uploadId = await multipart.init("c1/big.bin", {
      contentType: "application/octet-stream",
    });
    expect(uploadId).toBeTruthy();

    await multipart.uploadPart("c1/big.bin", uploadId, 1, bufferOf("part-one|"));
    await multipart.uploadPart("c1/big.bin", uploadId, 2, bufferOf("part-two"));
    expect((await multipart.listParts("c1/big.bin", uploadId)).sort()).toEqual([1, 2]);

    const result = await multipart.complete("c1/big.bin", uploadId, [
      { partNumber: 2, etag: "x" },
      { partNumber: 1, etag: "x" },
    ]);
    expect(result.size).toBe(17);
    // etag 必须是完整 64 位 sha256（秒传判定依赖，不能截断）
    expect(result.etag).toMatch(/^[0-9a-f]{64}$/);
    expect(await readAllText(await driver.get("c1/big.bin"))).toBe("part-one|part-two");

    await driver.delete("c1/big.bin");
    // abort 一个不存在的会话不应抛错
    await multipart.abort("c1/none.bin", "nope");
  });

  test("路径穿越防护", () => {
    expect(() => driver["resolve"]("../../escape.bin")).toThrow(/PATH_TRAVERSAL|非法存储键/);
  });

  test("工厂：local 返回本地驱动", () => {
    const made = createStorageDriver(
      { id: "x", type: "local", config: { root: "custom-root" } },
      { localRoot: "fallback" },
    );
    expect(made).toBeInstanceOf(LocalStorageDriver);
  });
});

describeS3("S3Driver（s3rver 兼容面）", () => {
  let driver: S3Driver;
  let admin: S3Client;

  beforeAll(async () => {
    driver = new S3Driver({
      bucket: "pstorage-test",
      region: "us-east-1",
      endpoint: S3_ENDPOINT,
      accessKeyId: "S3RVER",
      secretAccessKey: "S3RVER",
      rootPrefix: "conn-1",
    });
    // s3rver 的 configureBuckets 在部分环境下不落盘，这里显式建桶（幂等忽略 409）
    admin = new S3Client({
      region: "us-east-1",
      endpoint: S3_ENDPOINT,
      forcePathStyle: true,
      credentials: { accessKeyId: "S3RVER", secretAccessKey: "S3RVER" },
    });
    await admin.send(new CreateBucketCommand({ Bucket: "pstorage-test" })).catch(() => undefined);
  });

  test("契约用例", async () => {
    await exerciseDriverContract(driver, "2026/10", {
      listDelimiterWorks: false,
      listPartsWorks: false,
    });
  });

  test("multipart 生命周期（原生 multipart）", async () => {
    const multipart = driver.multipart!;
    const uploadId = await multipart.init("2026/10/big.bin");
    expect(uploadId).toBeTruthy();

    const part1 = await multipart.uploadPart("2026/10/big.bin", uploadId, 1, bufferOf("alpha-"));
    const part2 = await multipart.uploadPart("2026/10/big.bin", uploadId, 2, bufferOf("omega"));
    expect(part1.etag).toBeTruthy();
    if (!IS_S3RVER) {
      expect((await multipart.listParts("2026/10/big.bin", uploadId)).sort()).toEqual([1, 2]);
    }

    const result = await multipart.complete("2026/10/big.bin", uploadId, [
      { partNumber: 1, etag: part1.etag },
      { partNumber: 2, etag: part2.etag },
    ]);
    expect(result.size).toBe(11);
    expect(await readAllText(await driver.get("2026/10/big.bin"))).toBe("alpha-omega");

    // s3rver 3.7.1 未实现 AbortMultipartUpload（真 S3/MinIO/COS/OSS 均支持）
    if (!IS_S3RVER) {
      await multipart.abort("2026/10/never.bin", await multipart.init("2026/10/never.bin"));
    }
  });

  test("签名直链带文件名（content-disposition）", async () => {
    await driver.put("2026/10/signed.txt", bufferOf("signed-body"));
    const url = await driver.signDownloadUrl("2026/10/signed.txt", 300, "报表.csv");
    expect(url).toContain("X-Amz-Signature");
    const response = await fetch(url);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(await response.text()).toBe("signed-body");
    await driver.delete("2026/10/signed.txt");
  });
});

describe("工厂与缺省值", () => {
  test("DEFAULT_LOCAL_ROOT", () => {
    expect(DEFAULT_LOCAL_ROOT).toBe("storage");
  });

  test("s3 缺 bucket 直接构造失败", () => {
    expect(
      () =>
        new S3Driver({
          bucket: "",
          region: "r",
          endpoint: null,
          accessKeyId: "a",
          secretAccessKey: "b",
        }),
    ).toThrow();
  });
});
