/**
 * Estimates a PDF's page count directly from its raw bytes, without pulling
 * pdfjs into the client bundle just to read one number. Scans for
 * `/Type /Page` object markers (excluding `/Type /Pages`, the parent node).
 * Works for the common case of uncompressed PDF object structure (which
 * covers most PDFs produced by everyday tools). Returns null if nothing
 * matched, so callers can fall back gracefully rather than show a wrong
 * number.
 */
export function estimatePdfPageCount(bytes: ArrayBuffer): number | null {
  // Decode as latin1 - PDF structure/keywords are always ASCII regardless of
  // any binary stream content, so byte-for-byte latin1 decoding is safe here
  // and much faster than trying to properly parse the file.
  const text = new TextDecoder("latin1").decode(bytes);
  const matches = text.match(/\/Type\s*\/Page(?!s)\b/g);
  if (matches && matches.length > 0) {
    return matches.length;
  }
  // Fallback: some PDFs declare the count directly on the page tree root.
  const countMatch = text.match(/\/Type\s*\/Pages[^>]*?\/Count\s+(\d+)/);
  if (countMatch) {
    return parseInt(countMatch[1], 10);
  }
  return null;
}