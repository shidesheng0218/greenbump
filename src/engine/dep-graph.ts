import madge from "madge";
import { join } from "node:path";

export interface DependencyNode {
  file: string;
  imports: string[]; // files this file imports
  usesUpgradedPkg: boolean; // directly imports the upgraded package
}

export interface DependencyLayer {
  level: number; // 0 = directly uses upgraded pkg, 1 = imports level-0 files, etc.
  files: string[];
}

/**
 * Build a dependency graph for the codebase and identify which files
 * are affected by upgrading a specific package.
 *
 * This helps prioritize which files to fix first in a staged fix approach.
 */
export async function buildDependencyGraph(
  cwd: string,
  upgradedPkg: string
): Promise<DependencyNode[]> {
  try {
    // Use madge to analyze dependencies
    const result = await madge(cwd, {
      fileExtensions: ["js", "ts", "jsx", "tsx"],
      excludeRegExp: [/node_modules/, /dist/, /build/, /\.test\.|\.spec\./],
    });

    const graph = result.obj();
    const nodes: DependencyNode[] = [];

    // Convert madge graph to our format
    for (const [file, imports] of Object.entries(graph)) {
      const importsList = imports as string[];

      // Check if this file directly imports the upgraded package
      const usesUpgradedPkg = importsList.some((imp) => {
        // Match import statements like: import x from 'react'
        // or: const x = require('react')
        return imp === upgradedPkg || imp.startsWith(`${upgradedPkg}/`);
      });

      nodes.push({
        file,
        imports: importsList,
        usesUpgradedPkg,
      });
    }

    return nodes;
  } catch (err) {
    // Madge might fail on certain codebases - return empty graph
    console.warn(`Failed to build dependency graph: ${(err as Error).message}`);
    return [];
  }
}

/**
 * Organize files into layers based on dependency distance from the upgraded package.
 *
 * Layer 0: Files that directly import the upgraded package
 * Layer 1: Files that import Layer 0 files
 * Layer 2: Files that import Layer 1 files
 * etc.
 *
 * This layering helps fix files in order: fix the "leaves" first (directly affected),
 * then work up the dependency tree.
 */
export function organizeLayers(nodes: DependencyNode[]): DependencyLayer[] {
  const layers: DependencyLayer[] = [];
  const fileToLayer = new Map<string, number>();

  // Layer 0: direct users of the upgraded package
  const layer0Files = nodes
    .filter((n) => n.usesUpgradedPkg)
    .map((n) => n.file);

  if (layer0Files.length === 0) {
    // No direct imports found - return all files as one layer
    return [
      {
        level: 0,
        files: nodes.map((n) => n.file),
      },
    ];
  }

  layers.push({ level: 0, files: layer0Files });
  layer0Files.forEach((f) => fileToLayer.set(f, 0));

  // Build subsequent layers
  let currentLayer = 0;
  let remainingNodes = nodes.filter((n) => !n.usesUpgradedPkg);

  while (remainingNodes.length > 0 && currentLayer < 10) {
    // Cap at 10 layers to avoid infinite loops
    currentLayer++;
    const prevLayerFiles = layers[currentLayer - 1].files;
    const nextLayerFiles: string[] = [];

    for (const node of remainingNodes) {
      // Check if this node imports any files from the previous layer
      const importsPrevLayer = node.imports.some((imp) =>
        prevLayerFiles.includes(imp)
      );

      if (importsPrevLayer) {
        nextLayerFiles.push(node.file);
        fileToLayer.set(node.file, currentLayer);
      }
    }

    if (nextLayerFiles.length === 0) {
      // No more dependencies found - remaining files are unaffected
      break;
    }

    layers.push({ level: currentLayer, files: nextLayerFiles });
    remainingNodes = remainingNodes.filter(
      (n) => !fileToLayer.has(n.file)
    );
  }

  return layers;
}

/**
 * Get a flat list of files to fix, ordered by dependency layer (leaves first).
 * This is what the fix loop will iterate through.
 */
export function getPrioritizedFiles(layers: DependencyLayer[]): string[] {
  return layers.flatMap((layer) => layer.files);
}
