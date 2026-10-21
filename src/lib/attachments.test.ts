import { describe, expect, it, vi } from "vitest";

vi.mock("heic2any", () => ({ default: vi.fn(async () => { throw new Error("no decoder"); }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { AttachmentError, defaultName, DOCX, formatBytes, isHeic, MAX_BYTES, mimeOf, prepareFile } from "./attachments";

const file = (name: string, type: string, size = 100) => {
  const f = new File([new Uint8Array(Math.min(size, 16))], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
};

describe("attachments: browser checks before upload (S4b)", () => {
  it("takes the type from the browser, or from the extension when it is empty", () => {
    expect(mimeOf(file("a.pdf", "application/pdf"))).toBe("application/pdf");
    expect(mimeOf(file("Plan.DOCX", ""))).toBe(DOCX);
    expect(mimeOf(file("scan.JPG", ""))).toBe("image/jpeg");
    expect(mimeOf(file("x.exe", "application/x-msdownload"))).toBe("application/x-msdownload");
  });
  it("names the file without its extension", () => {
    expect(defaultName(file("Signed consent.pdf", "application/pdf"))).toBe("Signed consent");
    expect(defaultName(file(".pdf", "application/pdf"))).toBe("File");
  });
  it("recognizes HEIC by type or extension", () => {
    expect(isHeic(file("IMG_1.HEIC", ""))).toBe(true);
    expect(isHeic(file("a", "image/heif"))).toBe(true);
    expect(isHeic(file("a.jpg", "image/jpeg"))).toBe(false);
  });
  it("formats sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(3.5 * 1024 * 1024)).toBe("3.5 MB");
  });
  it("refuses other types, empty files and files over 20 MB; accepts a PDF of exactly 20 MB", async () => {
    await expect(prepareFile(file("x.exe", "application/x-msdownload"))).rejects.toThrow(/isn't accepted/);
    await expect(prepareFile(file("e.pdf", "application/pdf", 0))).rejects.toThrow(/empty/);
    await expect(prepareFile(file("big.pdf", "application/pdf", MAX_BYTES + 1))).rejects.toThrow(/at most 20 MB/);
    const ok = await prepareFile(file("max.pdf", "application/pdf", MAX_BYTES));
    expect(ok.mime).toBe("application/pdf");
  });
  it("gives a clear error when a HEIC photo can't be converted on the device", async () => {
    const e = await prepareFile(file("IMG_2.heic", "image/heic")).catch((x) => x);
    expect(e).toBeInstanceOf(AttachmentError);
    expect(e.message).toMatch(/couldn't be converted.*Most Compatible.*PDF/);
  });
});
