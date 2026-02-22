import sys
import json
import os

# Try to import pypdf (the modern, robust version), fallback to PyPDF2 if missing
# pypdf is the library used in combine_app.py and is much more stable.
try:
    from pypdf import PdfReader, PdfWriter
except ImportError:
    try:
        from PyPDF2 import PdfReader, PdfWriter
    except ImportError:
        print(json.dumps({"success": False, "error": "PDF library (pypdf or PyPDF2) not found. Please install 'pypdf' via pip."}))
        sys.exit(1)

def merge_pdfs(input_data):
    """
    Merges PDF files based on the robust patterns found in combine_app.py.
    Modified to ensure rotations and scaling work correctly together.
    """
    items = input_data.get('items', [])
    raw_output = input_data.get('outputPath')
    resize_to_fit = input_data.get('resizeToFit', False)
    
    # Standard A4 width in points (72 DPI)
    A4_WIDTH = 595.0

    # Extract filePath
    if isinstance(raw_output, dict):
        if raw_output.get('canceled'):
            return
        output_path = raw_output.get('filePath')
    else:
        output_path = raw_output

    if not items or not output_path:
        raise ValueError("Missing items or valid output path.")

    writer = PdfWriter()
    readers = {}

    for item in items:
        file_path = item.get('path')
        page_index = item.get('originalIndex', 0)
        
        try:
            rotation = int(item.get('rot', 0))
        except (ValueError, TypeError):
            rotation = 0
        
        if not file_path or not os.path.exists(file_path):
            continue

        try:
            # Open file once and reuse reader
            if file_path not in readers:
                # strict=False is crucial for handling malformed PDFs
                readers[file_path] = PdfReader(file_path, strict=False)
            
            reader = readers[file_path]
            if page_index >= len(reader.pages):
                continue
                
            # Get the page object from the reader
            source_page = reader.pages[page_index]
            
            # --- ADD TO WRITER FIRST ---
            # We add the page to the writer to get a reference to the page in the 
            # output document. Modifying this object ensures changes are preserved
            # without polluting the reader's cache.
            new_page = writer.add_page(source_page)
            
            # --- 1. Rotation Logic ---
            if rotation != 0:
                # Apply rotation to the output page. pypdf's rotate() is additive.
                new_page.rotate(rotation)
            
            # --- 2. Robust Scaling Logic ---
            if resize_to_fit:
                # Extract the current absolute rotation of the page
                try:
                    # Try accessing the property directly
                    current_rot = int(getattr(new_page, 'rotation', new_page.get('/Rotate', 0)))
                except Exception:
                    current_rot = 0
                    
                # When a page is rotated by 90 or 270 degrees, its visual 
                # width and height are swapped relative to its mediabox.
                is_swapped = (current_rot / 90) % 2 != 0
                
                # Get the internal dimensions
                pw = float(new_page.mediabox.width)
                ph = float(new_page.mediabox.height)
                
                # Determine the visual width (the one the user sees)
                visual_width = ph if is_swapped else pw
                
                if visual_width > 0 and abs(visual_width - A4_WIDTH) > 1.0:
                    scale = A4_WIDTH / visual_width
                    # scale_by automatically handles the internal Transformation Matrix
                    # and scales all boundary boxes correctly.
                    new_page.scale_by(scale)
                
        except Exception as e:
            # Log specific page error to stderr
            print(f"Error processing {file_path} page {page_index}: {str(e)}", file=sys.stderr)
            continue

    try:
        # Add metadata using standard PDF keys
        meta_data = input_data.get('metadata', {})
        writer_meta = {}
        if meta_data.get('title'): writer_meta["/Title"] = meta_data['title']
        if meta_data.get('author'): writer_meta["/Author"] = meta_data['author']
        writer_meta["/Producer"] = "Combine+ Exporter"
        
        writer.add_metadata(writer_meta)
        
        # Perform the final write
        with open(output_path, 'wb') as f:
            writer.write(f)
            
    except Exception as e:
        raise Exception(f"Failed to write output file: {str(e)}")

if __name__ == "__main__":
    try:
        if len(sys.argv) < 2:
            print(json.dumps({"success": False, "error": "No input data provided"}))
            sys.exit(1)

        input_str = sys.argv[1]
        data = json.loads(input_str)
        
        merge_pdfs(data)
        
        # Return success signal to Electron
        print(json.dumps({"success": True}))
        
    except Exception as e:
        # Return error message to Electron
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)