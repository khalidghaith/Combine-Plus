# Combine+ v1.5.0 Release Notes

Welcome to **Combine+ version 1.5.0**! This major update introduces native vector annotations, advanced grouping capabilities, powerful optimization tools, and a new compliance reporting system.

## 🚀 What's New?

### 🖋️ Native Vector Annotations
- **Zero-Loss Quality:** Annotations are now injected as native PDF vector elements. Whether you zoom 100% or 6400%, your marks remain perfectly sharp.
- **Advanced Toolset:** 
    - **Freehand Pen & Highlighter:** for quick sketching and marking.
    - **Intelligent Shapes:** Precise Rectangle, Ellipse, Line, and Arrow tools.
    - **Text Callouts:** Add text boxes with automatically generated leader lines (arrows) that dynamically track your labels.
- **Styling Control:** Full support for custom line thickness, opacities, dashed/dotted styles, and fill colors.
- **History System:** Robust **Undo/Redo** functionality and a "Clear All" safety switch.

### 🍱 Grouping & Organization
- **Smart Grouping:** select multiple items and use the "Group Selected" command to merge them into a single virtual folder.
- **Selective Color Inheritance:** Grouped images now adoption the group’s color marker for consistency, while PDF pages retain their document colors to preserve their identity.
- **Dynamic Renaming:** Re-engineered renaming inputs allow seamless text selection without triggering accidental drag operations.

### 🛠️ Advanced Export Options
- **Export Modal:** Experience a new, robust export options menu that gives you full control over the final document.
- **Batch Export:** Drag and drop multiple files to batch process them into separate PDF documents automatically.
- **Resize to Fit Width:** Re-imagined logic to ensure every page in your combine document fits a standard A4 width while maintaining original vector data quality.

### 📉 PDF Optimization & Compliance
- **Compliance Reporting:** Introducing a detailed feedback system. After export, Combine+ now provides a "health check" report showing precisely which images were downsampled and which compliance fixes were applied.
- **Smart Image Downsampling:** Reduce the file size of your documents by compressing high-resolution images with custom DPI control.
- **Transparency Protection:** Logic automatically recognizes and skips transparent icons/logos to prevent artifacts and preserve overprint graphics.

## 🍱 UI & Workflow Enhancements
- **Intelligent Context Menus:** Actions like "Group Selected" and "Rotate" now dynamically disable based on your selection.
- **Slate Gray Markers:** Single images and loose pages now default to a neutral gray marker, making it easy to spot standalone assets.
- **Improved Grid Selection:** Fixed intermittent Shift+Click bugs in Grid View to ensure multi-selection always follows the visual order.

## ⚡ Technical Improvements
- **Hybrid Merge Engine:** Leverages a custom integration of **PyMuPDF** for image optimization/annotations and **pypdf** for final structure.
- **Rotation Engine 2.0:** Completely rebuilt coordinate mapping for annotations. Markups now maintain absolute relative positioning even when rotating pages between 0°, 90°, 180°, and 270°.
- **Vector Integrity:** Our "surgical sanitization" process for PDF/A exports preserves vector data where possible, falling back to rasterization only when necessary.

---
*Combine+ continues to evolve with your needs. Thank you for using our tools!*
