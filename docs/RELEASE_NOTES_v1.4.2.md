# Combine+ v1.4.2 Release Notes

**Release Date:** February 2026

## Features & Enhancements
- **Automated Update System:** Combine+ now automatically checks for the latest releases on GitHub upon startup. A notification will appear if an update is available.
- **Improved "About" Dialog:** Redesigned the "About" modal to align with Help and Settings menus. It now includes a "Check for Updates" button that allows users to manually verify their version and download the latest release directly from GitHub.
- **Unlimited Context Menu Selections:** Fixed the Windows-enforced 15-file selection limit. You can now select an unlimited number of files in Windows Explorer, right-click, and successfully select "Merge with Combine+".
- **List View Context Menu:** Added a new Right-Click Context Menu in the List View, featuring quick "Expand All" and "Collapse All" functionality for better organization of multi-page documents.
- **Smart Viewer Auto-Fit:** The Detail Viewer now automatically applies "Fit to Page" scaling when initially opening a document. Additionally, when using the Next/Previous buttons to navigate through pages, the viewer dynamically recalculates and snaps to the correct fit when encountering pages with different dimensions or aspect ratios.
- **High-Resolution Vector Restored:** Re-implemented the native `pdf.js` rendering engine in the detail viewer to ensure text and vector lines remain perfectly crisp and scalable at maximum zoom levels, resolving blurring issues caused by raster fallbacks.

## Bug Fixes
- **Metadata Export Fix:** Resolved an issue where the "Title" and "Author" metadata fields in the user interface were being ignored during export. The metadata is now successfully injected into the final merged PDF.
- **Multi-Selection Operations:** Fixed a major bug where clicking Rotate, Duplicate, or Revert via the context buttons would only apply the action to the currently hovered page, completely ignoring the rest of the active selection pool. Actions now batch apply to *all* currently selected pages simultaneously.
- **Duplication Revert Logic:** Fixed a scoping issue where attempting to Revert a page that was dragged out of a *duplicated* PDF would incorrectly send the page skyrocketing back to the *original* source PDF instead of the cloned item.
- **Thumbnail Rotation Alignment:** Fixed an issue where the sidebar thumbnails would not accurately reflect the visual rotation of the page if the source PDF had a baked-in, hidden intrinsic rotation hardware tag.
- **Viewport Dimension Crash (NaN):** Fixed a silent failure where the viewer's "Fit Width" and "Fit Page" buttons would completely fail on specific PDFs generated without a default `/Rotate` matrix attribute. 
- **Merge Engine Scaling Fix:** Fixed a critical bug in the backend Python `merge_engine` where the "Resize to fit width" export feature squashed natively landscape-rotated pages incorrectly. The engine now correctly pulls the absolute rotation sum before calculating the dynamic aspect ratio box flip.
- **Image Naming Persistence:** Fixed an issue where images dragged out of a PDF container lost their original filenames and were generically relabeled as "Image" in the grid/list views. Original filenames are now permanently retained in memory.
