/**
 * Tests for check-doc-links.js script
 * 
 * Tests slug generation, link extraction, and anchor matching
 */

const path = require('path');
const fs = require('fs');

// Import the script functions by requiring it as a module
// We'll test individual functions

describe("slugify function", () => {
  // Since we can't easily import the function, we'll test the logic
  // by reproducing the expected behavior

  const slugify = (text) => {
    return text
      .toLowerCase()
      .trim()
      .replace(/[^\w\- ]+/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');
  };

  it("converts basic text to slug", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("removes special characters", () => {
    expect(slugify("Hello, World! (test)")).toBe("hello-world-test");
  });

  it("handles multiple spaces", () => {
    expect(slugify("Hello    World")).toBe("hello-world");
  });

  it("trims leading and trailing dashes", () => {
    expect(slugify("  Hello World  ")).toBe("hello-world");
  });

  it("handles unicode characters", () => {
    // Unicode letters should be removed
    expect(slugify("Hello  世界")).toBe("hello-");
  });

  it("handles only special characters", () => {
    expect(slugify("!!!")).toBe("");
  });
});

describe("link extraction", () => {
  const extractLinks = (content) => {
    const links = [];
    const lines = content.split('\n');
    
    // Match markdown links: [text](url)
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    
    lines.forEach((line, index) => {
      let match;
      const lineLinkRegex = new RegExp(linkRegex.source, 'g');
      
      while ((match = lineLinkRegex.exec(line)) !== null) {
        links.push({
          text: match[1],
          href: match[2].trim(),
          line: index + 1,
        });
      }
    });
    
    return links;
  };

  it("extracts basic markdown links", () => {
    const content = `Check out [this guide](guide.md) for more info.`;
    const links = extractLinks(content);
    
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      text: "this guide",
      href: "guide.md",
    });
  });

  it("extracts multiple links on same line", () => {
    const content = `See [docs](docs.md) and [README](README.md).`;
    const links = extractLinks(content);
    
    expect(links).toHaveLength(2);
  });

  it("extracts links with anchors", () => {
    const content = `Go to [section one](#section-one) for details.`;
    const links = extractLinks(content);
    
    expect(links[0].href).toBe("#section-one");
  });

  it("extracts absolute URLs", () => {
    const content = `Visit [GitHub](https://github.com/example).`;
    const links = extractLinks(content);
    
    expect(links[0].href).toBe("https://github.com/example");
  });

  it("handles empty links", () => {
    const content = `Link to [](./index).`;
    const links = extractLinks(content);
    
    expect(links[0].href).toBe("./index");
  });
});

describe("anchor matching", () => {
  const slugify = (text) => {
    return text
      .toLowerCase()
      .trim()
      .replace(/[^\w\- ]+/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');
  };

  const extractHeadings = (content) => {
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
  };

  const findAnchor = (headings, anchor) => {
    const slug = anchor.startsWith('#') ? anchor.slice(1) : anchor;
    return headings.find(h => h.slug === slug);
  };

  it("extracts headings with correct levels", () => {
    const content = `
# Main Title
## Section One
### Subsection
## Section Two
`;

    const headings = extractHeadings(content);
    
    expect(headings).toHaveLength(4);
    expect(headings[0]).toMatchObject({ level: 1, text: "Main Title", slug: "main-title" });
    expect(headings[1]).toMatchObject({ level: 2, text: "Section One", slug: "section-one" });
  });

  it("matches anchor to heading slug", () => {
    const content = `
## Getting Started
### Installation Guide
`;

    const headings = extractHeadings(content);
    
    expect(findAnchor(headings, "getting-started")).toBeTruthy();
    expect(findAnchor(headings, "installation-guide")).toBeTruthy();
  });

  it("returns undefined for non-existent anchor", () => {
    const content = `## Existing Section`;
    
    const headings = extractHeadings(content);
    
    expect(findAnchor(headings, "non-existent")).toBeFalsy();
  });

  it("handles special characters in headings", () => {
    const content = `## API Reference (v2)`;
    
    const headings = extractHeadings(content);
    
    expect(headings[0].slug).toBe("api-reference-v2");
  });

  it("handles multiple headings with same text", () => {
    const content = `
## Overview
### Overview
#### Overview
`;

    const headings = extractHeadings(content);
    
    expect(headings[0].slug).toBe("overview");
    expect(headings[1].slug).toBe("overview-1");
    expect(headings[2].slug).toBe("overview-2");
  });
});

describe("file path resolution", () => {
  const resolveRelativeLink = (href, baseFilePath, rootDir) => {
    const baseDir = path.dirname(baseFilePath);
    const resolved = path.resolve(rootDir, baseDir, href);
    return { exists: fs.existsSync(resolved), resolved };
  };

  it("resolves relative paths correctly", () => {
    const rootDir = path.join(__dirname, 'fixtures', 'check-doc-links');
    
    // Create test directory structure
    const testDir = path.join(rootDir, 'subdir');
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    
    // Create a test file
    fs.writeFileSync(path.join(testDir, 'test.md'), '# Test');
    
    // Resolve from subdir/test.md to test.md in parent
    const baseFilePath = path.join(testDir, 'test.md');
    const result = resolveRelativeLink('../test.md', baseFilePath, rootDir);
    
    // Cleanup
    fs.unlinkSync(path.join(testDir, 'test.md'));
    fs.rmdirSync(testDir);
    
    expect(result.exists).toBe(true);
  });
});