import "server-only";
import { createCanvas } from "@napi-rs/canvas";

// pdfjs-dist v6 legacy build - works in plain Node (no DOM) when given an
// explicit canvas factory. We patch the canvas creation with @napi-rs/canvas,
// which ships prebuilt native binaries (no system cairo/pango needed), so it
// works both locally and on serverless platforms like Vercel.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pdfjsLib: any = null;

async function getPdfjs() {
  if (!pdfjsLib) {
    pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  }
  return pdfjsLib;
}

export type RenderedPage = {
  page: number;
  width: number;
  height: number;
  dataUrl: string;
  pngBuffer: Buffer;
};

const RENDER_SCALE = 2.0; // ~144 DPI equivalent for a 72dpi PDF unit page - good balance of clarity vs payload size
const MAX_PAGES = 30;

/**
 * Converts a PDF (as bytes) into an array of rendered page PNGs, in printed order.
 */
export async function renderPdfToImages(bytes: Uint8Array): Promise<RenderedPage[]> {
  const pdfjs = await getPdfjs();
  const loadingTask = pdfjs.getDocument({
    data: bytes,
    disableFontFace: true,
    isEvalSupported: false,
  });
  const pdf = await loadingTask.promise;
  const numPages = Math.min(pdf.numPages, MAX_PAGES);

  const pages: RenderedPage[] = [];
  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: RENDER_SCALE });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext("2d");

    // @napi-rs/canvas's context is close enough to the DOM CanvasRenderingContext2D
    // surface that pdf.js's renderer works against it directly.
    await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport }).promise;

    const pngBuffer = canvas.toBuffer("image/png");
    pages.push({
      page: i,
      width: canvas.width,
      height: canvas.height,
      dataUrl: `data:image/png;base64,${pngBuffer.toString("base64")}`,
      pngBuffer,
    });
  }
  return pages;
}

/**
 * Normalizes a raw image upload (jpg/png/webp) into the same RenderedPage shape,
 * as a single "page 1". Re-encodes through @napi-rs/canvas so downstream code
 * can rely on PNG + known pixel dimensions uniformly.
 */
export async function imageToRenderedPage(bytes: Uint8Array): Promise<RenderedPage> {
  const { Image } = await import("@napi-rs/canvas");
  const img = new Image();
  img.src = Buffer.from(bytes);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const pngBuffer = canvas.toBuffer("image/png");
  return {
    page: 1,
    width: canvas.width,
    height: canvas.height,
    dataUrl: `data:image/png;base64,${pngBuffer.toString("base64")}`,
    pngBuffer,
  };
}

export async function fileToRenderedPages(bytes: Uint8Array, mimeType: string): Promise<RenderedPage[]> {
  if (mimeType === "application/pdf") {
    return renderPdfToImages(bytes);
  }
  if (mimeType.startsWith("image/")) {
    return [await imageToRenderedPage(bytes)];
  }
  throw new Error(`Unsupported file type: ${mimeType}`);
}
