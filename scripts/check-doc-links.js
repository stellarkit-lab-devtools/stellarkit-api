#!/usr/bin/env node

/**
 * Documentation Link Checker
 * 
 * Scans README files, CONTRIBUTING.md and docs/**/*.md to verify:
 * - Relative links resolve to existing files
 * - #anchors match real headings using GitHub's slug rules
 * - External links are valid (with --external flag, HEAD-checked with timeout and concurrency of 5)
 * 
 * Usage: node scripts/check-doc-links.js [--external]
 */

const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// Configuration
const ROOT_DIR = path.resolve(__dirname, '..');
const EXTERNAL_CONCURRENCY = 5;
const EXTERNAL_TIMEOUT = 5000;

// File patterns to scan
const SCAN_PATTERNS = [
  'README.md',
  'CONTRIBUTING.md',
  'docs/**/*.md',
];

// Directories to scan
const SCAN_DIRS = [
  '.',
  'docs',
];

/**
 * Generate GitHub-style slug from heading text
 * https://github.com/jneen/rouge/wiki/GitHub-Markdown-slugification
 */
function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\- ]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Extract all headings with their slugs from a markdown file
 */
function extractHeadings(content) {
  const headings = [];
  const regex = /^(#{1,6})\s+(.+)$/gm;
  let match;
  
  while ((match = regex.exec(content)) !== null) {
    const level = match[1].length;
    const text = match[2].trim();
    const slug = slugify(text);
    headings.push({ level, text, slug });
  }
  
  return headings;
}

/**
 * Extract all links from markdown content
 * Returns array of { text, href, lineNumber }
 */
function extractLinks(content, filePath) {
  const links = [];
  const lines = content.split('\n');
  
  // Match markdown links: [text](url)
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  
  // Match reference links: [text][id] or [id]:
  const refLinkRegex = /\[([^\]]+)\]\[([^\]]+)\]/g;
  const refDefRegex = /^\s*\[([^\]]+)\]:\s*(.+)$/m;
  
  const referenceDefs = {};
  
  // First pass: collect reference definitions
  lines.forEach((line, index) => {
    const match = line.match(refDefRegex);
    if (match) {
      referenceDefs[match[1].toLowerCase()] = {
        href: match[2].trim(),
        line: index + 1,
      };
    }
  });
  
  // Second pass: extract inline links
  lines.forEach((line, index) => {
    let match;
    const lineLinkRegex = new RegExp(linkRegex.source, 'g');
    
    while ((match = lineLinkRegex.exec(line)) !== null) {
      const text = match[1];
      let href = match[2].trim();
      
      // Skip mailto, tel, etc.
      if (href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) {
        continue;
      }
      
      links.push({
        text,
        href,
        line: index + 1,
        filePath,
      });
    }
  });
  
  // Third pass: extract reference links
  lines.forEach((line, index) => {
    let match;
    const lineRefRegex = new RegExp(refLinkRegex.source, 'g');
    
    while ((match = lineRefRegex.exec(line)) !== null) {
      const text = match[1];
      const refId = match[2].toLowerCase();
      const def = referenceDefs[refId];
      
      if (def) {
        links.push({
          text,
          href: def.href,
          line: index + 1,
          filePath,
          isReference: true,
        });
      } else {
        // Reference without definition - report as broken reference link
        links.push({
          text,
          href: `[${refId}]`,
          line: index + 1,
          filePath,
          isReference: true,
          brokenRef: true,
        });
      }
    }
  });
  
  return links;
}

/**
 * Check if a relative link resolves to an existing file
 */
function resolveRelativeLink(href, baseFilePath) {
  const baseDir = path.dirname(baseFilePath);
  const resolved = path.resolve(ROOT_DIR, baseDir, href);
  
  // Remove hash/anchor if present
  const withoutHash = resolved.split('#')[0];
  
  // Check if file exists
  if (!fs.existsSync(withoutHash)) {
    // Check common variations
    const withoutExt = withoutHash.replace(/\.md$/i, '');
    const withMd = withoutExt + '.md';
    
    if (fs.existsSync(withMd)) {
      return { exists: true, resolved: withMd };
    }
    
    return { exists: false, resolved: withoutHash };
  }
  
  return { exists: true, resolved: withoutHash };
}

/**
 * Check if an anchor exists in a file
 */
function checkAnchor(filePath, anchor) {
  if (!fs.existsSync(filePath)) {
    return { exists: false, reason: 'file not found' };
  }
  
  const content = fs.readFileSync(filePath, 'utf-8');
  const headings = extractHeadings(content);
  
  // Try the exact slug
  const slug = anchor.startsWith('#') ? anchor.slice(1) : anchor;
  const found = headings.find(h => h.slug === slug);
  
  if (found) {
    return { exists: true, heading: found.text };
  }
  
  return { exists: false, availableSlugs: headings.map(h => h.slug).slice(0, 10) };
}

/**
 * Fetch URL and check if it's accessible
 */
async function checkExternalLink(href) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve({ accessible: false, reason: 'timeout' });
    }, EXTERNAL_TIMEOUT);
    
    try {
      const url = new URL(href);
      
      const options = {
        method: 'HEAD',
        headers: {
          'User-Agent': 'StellarKit-LinkChecker/1.0',
        },
      };
      
      fetch(href, options)
        .then(response => {
          clearTimeout(timeout);
          if (response.ok) {
            resolve({ accessible: true, status: response.status });
          } else if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
            // Follow redirect
            checkExternalLink(response.headers.get('location')).then(resolve);
          } else {
            resolve({ accessible: false, reason: `HTTP ${response.status}` });
          }
        })
        .catch(err => {
          clearTimeout(timeout);
          resolve({ accessible: false, reason: err.message });
        });
    } catch (err) {
      clearTimeout(timeout);
      resolve({ accessible: false, reason: err.message });
    }
  });
}

/**
 * Get all markdown files in scan directories
 */
function getMarkdownFiles() {
  const files = [];
  
  for (const dir of SCAN_DIRS) {
    const dirPath = path.join(ROOT_DIR, dir);
    
    if (!fs.existsSync(dirPath)) continue;
    
    const scanDir = (currentPath) => {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);
        
        if (entry.isDirectory()) {
          if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
            scanDir(fullPath);
          }
        } else if (entry.name.endsWith('.md')) {
          files.push(path.relative(ROOT_DIR, fullPath));
        }
      }
    };
    
    scanDir(dirPath);
  }
  
  return files;
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);
  const checkExternal = args.includes('--external');
  
  console.log('Checking documentation links...\n');
  console.log(`Root directory: ${ROOT_DIR}`);
  console.log(`Check external links: ${checkExternal ? 'YES' : 'NO'}\n`);
  
  const files = getMarkdownFiles();
  console.log(`Found ${files.length} markdown files to check.\n`);
  
  const failures = [];
  const externalLinks = [];
  
  for (const file of files) {
    const filePath = path.join(ROOT_DIR, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const links = extractLinks(content, file);
    
    for (const link of links) {
      const { href, line, filePath: linkFilePath } = link;
      
      // Skip anchor-only links
      if (href.startsWith('#')) {
        continue;
      }
      
      // Check if external or internal
      try {
        const url = new URL(href);
        
        if (url.protocol === 'http:' || url.protocol === 'https:') {
          // External link
          if (checkExternal) {
            externalLinks.push({ href, file, line });
          }
          continue;
        }
      } catch (e) {
        // Not a valid URL, treat as relative
      }
      
      // Handle anchor in path (e.g., ./file.md#section)
      const [pathPart, anchorPart] = href.split('#');
      const cleanHref = pathPart || './'; // Handle #anchor-only links
      
      // Resolve relative link
      const resolved = resolveRelativeLink(cleanHref, file);
      
      if (!resolved.exists) {
        failures.push({
          file,
          line,
          message: `Link target does not exist: ${href}`,
          resolved: resolved.resolved,
        });
      } else if (anchorPart) {
        // Check if anchor exists in target file
        const anchorResult = checkAnchor(resolved.resolved, anchorPart);
        
        if (!anchorResult.exists) {
          failures.push({
            file,
            line,
            message: `Anchor '${anchorPart}' not found in ${path.basename(resolved.resolved)}`,
            availableAnchors: anchorResult.availableSlugs,
          });
        }
      }
    }
  }
  
  // Check external links if requested
  if (checkExternal && externalLinks.length > 0) {
    console.log(`Checking ${externalLinks.length} external links...\n`);
    
    // Process in batches
    for (let i = 0; i < externalLinks.length; i += EXTERNAL_CONCURRENCY) {
      const batch = externalLinks.slice(i, i + EXTERNAL_CONCURRENCY);
      const results = await Promise.all(batch.map(link => checkExternalLink(link.href)));
      
      for (let j = 0; j < batch.length; j++) {
        const link = batch[j];
        const result = results[j];
        
        if (!result.accessible) {
          failures.push({
            file: link.file,
            line: link.line,
            message: `External link '${link.href}' failed: ${result.reason}`,
          });
        }
      }
    }
  }
  
  // Print results
  if (failures.length === 0) {
    console.log('✓ All links are valid!\n');
    process.exit(0);
  } else {
    console.log(`✗ Found ${failures.length} broken link(s):\n`);
    
    for (const failure of failures) {
      console.log(`${failure.file}:${failure.line}`);
      console.log(`  ${failure.message}`);
      if (failure.resolved) {
        console.log(`  (tried to resolve to: ${failure.resolved})`);
      }
      if (failure.availableAnchors) {
        console.log(`  Available anchors: ${failure.availableAnchors.join(', ')}`);
      }
      console.log('');
    }
    
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});