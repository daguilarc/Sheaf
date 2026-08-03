import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export async function findBrowserRoot(fromUrl = import.meta.url) {
  let directory = path.dirname(fileURLToPath(fromUrl));
  for (;;) {
    try {
      await readFile(path.join(directory, "Makefile"), "utf8");
      return directory;
    } catch (error) {
      if (path.dirname(directory) === directory) {
        throw error;
      }
      directory = path.dirname(directory);
    }
  }
}
