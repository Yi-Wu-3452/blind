# Requirement & Fix: Thread Expansion and Deleted Comment Nesting

## Problem Statement

The Blind scraper was reporting **"0 replies"** when expanding threads, even when comments were visible on the page. Additionally, deleted/flagged comments created structural issues that broke the comment tree hierarchy.

### Root Causes

1. **Sibling Blindness**: Thread expansion logic only captured the first comment on a thread page, ignoring all siblings
2. **Group Division**: Deleted comments split the DOM into separate `comment-group` containers, orphaning child comments from their logical parents
3. **Self-Nesting**: Expansion results included the parent anchor as a duplicate, creating an extra nesting level

---

## Challenge 1: Sibling Blindness in Thread Expansion

### The Issue
When clicking "View 5 more replies", the scraper navigated to the thread page but only extracted the **first comment**, treating it as the sole reply. All sibling comments were ignored.

**Example**: Expanding `comment-48775173` reported 1 reply instead of 8.

### The Fix: Capture All Root-Level Nodes
```javascript
// OLD: Only captured the first comment
const rootComment = document.querySelector('div[id^="comment-"]');

// NEW: Capture all siblings at the minimum depth
const allCommentDivs = Array.from(document.querySelectorAll('div[id^="comment-"]'));
const nodesWithDepth = allCommentDivs.map(el => ({ el, depth: getDepth(el) }));
const minDepth = Math.min(...nodesWithDepth.map(n => n.depth));
const rootNodes = nodesWithDepth.filter(n => n.depth === minDepth);
```

**Result**: All siblings are now captured as children of the expansion trigger.

---

## Challenge 2: Deleted Comments Dividing Groups

### The Issue
Blind's DOM structure splits comments into separate `comment-group-*` divs when a deleted/flagged comment appears. This creates "orphaned" continuation groups:

```html
<!-- Group A: Contains parent -->
<div id="comment-group-48770882">
  <div>[Deleted Placeholder]</div>
</div>

<!-- Group B: Orphaned children (should be nested under Group A) -->
<div id="comment-group-48775173">
  <div id="comment-48775173">AmericanTW</div>
  <div id="comment-48776792">lodbsfh</div>
  ...
</div>
```

The scraper treated Group B as top-level, breaking the logical parent-child relationship.

### The Fix: "Real Parent" Structural Scan
When a "View more replies" button is clicked, the scraper now **scans backwards** through previous `comment-group` siblings to find the **logical head** of the thread:

```javascript
let current = group;
let realParentId = group.id;

while (current) {
    const firstChildDiv = current.querySelector('div[id^="comment-"]:not([id^="comment-group-"])');
    if (firstChildDiv) {
        realParentId = firstChildDiv.id;
        break;
    }
    current = current.previousElementSibling;
    if (current && !current.id.startsWith('comment-group-')) break;
}
```

**Result**: Expansion results are keyed by the **real parent ID**, reuniting divided groups during final assembly.

---

## Challenge 3: Universal Stream Tree Builder

### The Issue
The original tree builder processed each `comment-group` in isolation, preventing it from reconnecting separated siblings across group boundaries.

### The Fix: Flatten and Sort by Visual Position
Instead of per-group trees, the scraper now:

1. **Collects all nodes globally** from every `comment-group`
2. **Sorts by vertical position** (`getBoundingClientRect().top`)
3. **Reconstructs hierarchy** using indentation depth and a stack-based algorithm

```javascript
const buildUniversalTree = (rootCommentGroups) => {
    const allNodesInStream = [];
    
    // Collect all nodes from all groups
    rootCommentGroups.forEach(groupElement => {
        // ... collect nodes with depth and position
    });
    
    // Sort globally by vertical position
    allNodesInStream.sort((a, b) => a.offsetTop - b.offsetTop);
    
    // Build tree using stack (depth-based nesting)
    const tree = [];
    const stack = [];
    
    allNodesInStream.forEach(item => {
        while (stack.length > 0 && stack[stack.length - 1].depth >= item.depth) {
            stack.pop();
        }
        
        if (stack.length === 0) {
            tree.push(item.data);
        } else {
            stack[stack.length - 1].data.nested.push(item.data);
        }
        stack.push(item);
    });
    
    return tree;
};
```

**Result**: Comments are nested based on how they **visually appear** on the page, naturally reuniting divided groups.

---

## Challenge 4: Self-Nesting Bug

### The Issue
Thread expansion results included the parent comment itself as a "context anchor", causing it to appear as its own first child:

```json
{
  "commentId": "comment-48774887",
  "nestedCount": 45,  // Wrong: 1 (duplicate parent) + 44 real children
  "nested": [
    {
      "commentId": "comment-48774887",  // ❌ Duplicate parent
      "nested": [ /* 44 real children */ ]
    }
  ]
}
```

### The Fix: Boot-Removal Deduplication
Before injecting expansion results, the scraper now detects and removes the duplicate parent:

```javascript
const duplication = external.find(ext => ext.commentId === item.data.commentId);
if (duplication) {
    // Strip the duplicate parent, but keep its children and siblings
    const otherSiblings = external.filter(ext => ext.commentId !== item.data.commentId);
    item.data.nested = [...(duplication.nested || []), ...otherSiblings];
} else {
    item.data.nested = external;
}
```

**Result**: Parents now have the correct `nestedCount`, and the tree is one level shallower.

---

## Verification Results

### Nvidia CEO Post
- **Before**: 0 replies captured for most expansions
- **After**: 191 comments scraped (189 active + 2 deleted)
- **Key Test Cases**:
  - `comment-48774887`: Correctly nested 44 children (no self-duplication)
  - `comment-48775173`: Correctly nested 8 siblings (previously 0)
  - Deleted parents: Children correctly nested under flagged placeholders

### No Duplicates
```
Total comments scraped: 191
Unique comment IDs: 191
✅ No duplicate comment IDs found!
```

---

## Summary

The scraper now handles Blind's complex DOM structure by:

1. **Capturing all siblings** on thread pages (not just the first)
2. **Scanning backwards** to find logical parents across divided groups
3. **Building a universal tree** from all nodes sorted by visual position
4. **Deduplicating** expansion results to prevent self-nesting

This ensures **complete, accurate comment trees** even when deleted comments split the DOM structure.
