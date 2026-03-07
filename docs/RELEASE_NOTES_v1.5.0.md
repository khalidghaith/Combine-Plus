# Combine+ v1.5.0 Release Notes

Welcome to **Combine+ version 1.5.0**! This major update introduces powerful optimization tools, advanced PDF format support, and improved file handling.

## 🚀 What's New?

### 🛠️ Advanced Export Options
- **Export Modal:** Experience a new, robust export options menu that gives you full control over the final document.
- **Batch Export:** Drag and drop multiple files to batch process them into separate PDF documents automatically.
- **Resize to Fit Width:** Re-imagined logic to ensure every page in your combine document fits a standard A4 width while maintaining original vector data quality.

### 📉 PDF Optimization & Compression
- **Smart Image Downsampling:** Reduce the file size of your documents by compressing high-resolution images.
- **DPI Control:** Set custom trigger and target resolutions to balance between crystal-clear quality and compact file footprints.
- **Transparency Protection:** Logic automatically recognizes and skips transparent icons/logos to prevent artifacts and preserve overprint graphics.

### 🍱 UI & Workflow Enhancements
- **Intelligent Context Menus:** Actions like "Group Selected" and "Rotate" now dynamically disable based on your selection. Irrelevant options like "Expand/Collapse All" are now hidden in Grid View for a cleaner workspace.
- **Robust Item Renaming:** Re-engineered renaming inputs to allow seamless text selection without triggering accidental drag operations.
- **Visual Organization:**
    - **Slate Gray Markers:** Single images and loose pages now default to a neutral gray marker, making it easy to spot standalone assets.
    - **Selective Color Inheritance:** Grouped images now adopt the group’s color marker for consistency, while PDF pages retain their document colors to preserve their identity.
- **Improved Grid Selection:** Fixed intermittent Shift+Click bugs in Grid View to ensure multi-selection always follows the visual order, even inside expanded containers.

### 🖼️ Expanded File Support
- **Native .BMP Support:** Import and merge BMP files alongside PDFs, JPGs, and PNGs.
- **Expanded Palette:** Now features **20 distinct marker colors**, making it effortless to identify pages from different sources.

## ⚡ Technical Improvements
- **Hybrid Merge Engine:** Leverages a custom integration of **PyMuPDF** for image optimization and **pypdf** for final structure and metadata integrity.
- **Jimp Integration:** Secure image decoding for non-standard image formats to ensure 100% reliability during combined exports.
- **Vector Integrity:** Fixed bugs where optimization routines were unintentionally flattening document layers.

---
*Combine+ continues to evolve with your needs. Thank you for using our tools!*
