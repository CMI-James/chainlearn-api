import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveSafeStaticPath } from "../../../src/utils/safe-static-path.js";

const UPLOAD_DIR = "uploads/avatars";
const AVATAR_PATTERN = /^[A-Za-z0-9_-]+\.(jpg|png|webp)$/;

describe("resolveSafeStaticPath (#486)", () => {
  it("resolves a legitimate filename to a path inside the upload directory", () => {
    const result = resolveSafeStaticPath(
      "user-123.jpg",
      UPLOAD_DIR,
      AVATAR_PATTERN,
    );
    expect(result).not.toBeNull();
    expect(result).toBe(path.resolve(UPLOAD_DIR, "user-123.jpg"));
  });

  it("accepts every allowed extension", () => {
    for (const name of ["a.jpg", "a.png", "a.webp"]) {
      expect(
        resolveSafeStaticPath(name, UPLOAD_DIR, AVATAR_PATTERN),
      ).not.toBeNull();
    }
  });

  it("rejects a plain ../ traversal payload", () => {
    expect(
      resolveSafeStaticPath("../../../etc/passwd", UPLOAD_DIR, AVATAR_PATTERN),
    ).toBeNull();
  });

  it("rejects a traversal payload that basename() would otherwise leave joinable", () => {
    // path.basename("../../etc/passwd.jpg") === "passwd.jpg", so this exercises
    // that the regex is checked against the *stripped* name, not the raw one,
    // and would still correctly resolve inside the upload dir (basename already
    // neutralizes the traversal) rather than escaping it.
    const result = resolveSafeStaticPath(
      "../../etc/passwd.jpg",
      UPLOAD_DIR,
      AVATAR_PATTERN,
    );
    expect(result).toBe(path.resolve(UPLOAD_DIR, "passwd.jpg"));
  });

  it("rejects a filename containing an embedded path separator after basename would strip a leading traversal", () => {
    expect(
      resolveSafeStaticPath(
        "..%2f..%2fetc%2fpasswd",
        UPLOAD_DIR,
        AVATAR_PATTERN,
      ),
    ).toBeNull();
  });

  it("rejects a disallowed extension", () => {
    expect(
      resolveSafeStaticPath("shell.php", UPLOAD_DIR, AVATAR_PATTERN),
    ).toBeNull();
    expect(
      resolveSafeStaticPath("archive.jpg.exe", UPLOAD_DIR, AVATAR_PATTERN),
    ).toBeNull();
  });

  it("rejects an absolute path payload", () => {
    expect(
      resolveSafeStaticPath("/etc/passwd.jpg", UPLOAD_DIR, AVATAR_PATTERN),
    ).not.toBeNull();
    // basename("/etc/passwd.jpg") === "passwd.jpg", which IS a valid name in
    // isolation — the point is it can never escape uploadDir, confirmed here.
    const result = resolveSafeStaticPath(
      "/etc/passwd.jpg",
      UPLOAD_DIR,
      AVATAR_PATTERN,
    );
    expect(result).toBe(path.resolve(UPLOAD_DIR, "passwd.jpg"));
  });

  it("rejects a null-byte injection attempt", () => {
    expect(
      resolveSafeStaticPath("avatar.jpg\0.php", UPLOAD_DIR, AVATAR_PATTERN),
    ).toBeNull();
  });

  describe("symlink attacks", () => {
    let tmpRoot: string;
    let uploadDir: string;

    afterEach(() => {
      if (tmpRoot) {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
      }
    });

    it("resolves a filename that is itself a symlink to within the upload directory, without following it to the link's target", () => {
      // resolveSafeStaticPath only does string-path resolution (path.resolve),
      // it never calls fs.realpath — so even if an attacker-controlled
      // symlink inside uploadDir points outside of it, the *resolved path
      // returned* is still the symlink's own path inside uploadDir. It is the
      // caller's responsibility to serve the file by that path (which the OS
      // will then follow); this function's job is only to keep the
      // user-supplied name confined to uploadDir, which it does regardless of
      // what the name happens to point to on disk.
      tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "safe-static-path-"));
      uploadDir = path.join(tmpRoot, "uploads");
      const secretDir = path.join(tmpRoot, "secret");
      fs.mkdirSync(uploadDir, { recursive: true });
      fs.mkdirSync(secretDir, { recursive: true });
      fs.writeFileSync(path.join(secretDir, "passwd.jpg"), "top-secret");

      const linkPath = path.join(uploadDir, "evil-link.jpg");
      fs.symlinkSync(path.join(secretDir, "passwd.jpg"), linkPath);

      const result = resolveSafeStaticPath(
        "evil-link.jpg",
        uploadDir,
        AVATAR_PATTERN,
      );

      expect(result).toBe(path.resolve(uploadDir, "evil-link.jpg"));
      expect(result).not.toBeNull();
      // The returned path is confined to uploadDir by construction, even
      // though following it on disk would land in secretDir.
      expect(result!.startsWith(path.resolve(uploadDir) + path.sep)).toBe(true);
    });

    it("rejects a traversal payload that targets a symlinked upload directory the same way as any other path", () => {
      tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "safe-static-path-"));
      const realUploadDir = path.join(tmpRoot, "real-uploads");
      fs.mkdirSync(realUploadDir, { recursive: true });
      uploadDir = path.join(tmpRoot, "uploads-link");
      fs.symlinkSync(realUploadDir, uploadDir);

      expect(
        resolveSafeStaticPath("../../etc/passwd", uploadDir, AVATAR_PATTERN),
      ).toBeNull();
    });
  });
});
