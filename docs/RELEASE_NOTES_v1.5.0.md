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

### 📜 Professional PDF Standards
- **PDF/A Compliance:** Full support for archival formats, including a comprehensive list from **PDF/A-1a** to **PDF/A-4f**.
- **PDF/X Readiness:** New support for print-ready standards: **PDF/X-1a**, **PDF/X-3**, and **PDF/X-4**.
- **XMP Metadata Injection:** Direct structural catalog updates ensure your documents trigger compliance flags in Adobe Acrobat.

### 🖼️ Expanded File Support
- **Native .BMP Support:** You can now import and merge BMP image files alongside PDFs, JPGs, and PNGs.
- **Unique Color Markers:** Expanded palette of **20 distinct marker colors**, making it effortless to identify pages from different source documents in the workspace.

## ⚡ Technical Improvements
- **Hybrid Merge Engine:** Leverages a custom integration of **PyMuPDF** for image optimization and **pypdf** for final structure and metadata integrity.
- **Jimp Integration:** Secure image decoding for non-standard image formats to ensure 100% reliability during combined exports.
- **Vector Integrity:** Fixed bugs where optimization routines were unintentionally flattening document layers.

---
*Combine+ continues to evolve with your needs. Thank you for using our tools!*
