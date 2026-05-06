import JSZip from "jszip";
import { saveAs } from "file-saver";

export async function buildZip(
  files: Record<string, string>,
): Promise<Blob> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) {
    zip.file(path, content);
  }
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}

export function downloadBlob(blob: Blob, filename: string) {
  saveAs(blob, filename);
}

export function downloadText(text: string, filename: string) {
  const blob = new Blob([text], { type: "text/html;charset=utf-8" });
  saveAs(blob, filename);
}
