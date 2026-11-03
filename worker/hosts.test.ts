import { describe, expect, test } from "vite-plus/test";
import { isAllowedHost, isPrivateHost } from "./hosts.ts";

describe("isPrivateHost", () => {
  test.each([
    "localhost",
    "127.0.0.1",
    "10.1.2.3",
    "192.168.0.10",
    "172.16.5.4",
    "172.31.0.1",
    "169.254.169.254",
    "[::1]",
    "printer.local",
    "db.internal",
  ])("%s はプライベート", (host) => expect(isPrivateHost(host)).toBe(true));
  test.each(["www.moj.go.jp", "www.city.shinjuku.lg.jp", "www.jlpt.jp", "172.32.0.1", "8.8.8.8"])(
    "%s は公開",
    (host) => expect(isPrivateHost(host)).toBe(false),
  );
});

describe("isAllowedHost", () => {
  test("既定（* や未設定）はどのサイトも可", () => {
    expect(isAllowedHost("www.jlpt.jp", "*")).toBe(true);
    expect(isAllowedHost("www.jlpt.jp", undefined)).toBe(true);
    expect(isAllowedHost("www.jlpt.jp", "")).toBe(true);
  });
  test("絞り込み: . で始まるものは末尾一致、それ以外は完全一致", () => {
    const rules = ".go.jp,.lg.jp,www.jlpt.jp";
    expect(isAllowedHost("www.moj.go.jp", rules)).toBe(true);
    expect(isAllowedHost("lg.jp", rules)).toBe(true);
    expect(isAllowedHost("www.jlpt.jp", rules)).toBe(true);
    expect(isAllowedHost("jlpt.jp", rules)).toBe(false);
    expect(isAllowedHost("evil-go.jp", rules)).toBe(false);
  });
});
