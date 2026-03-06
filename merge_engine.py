import sys
import json
import os
import tempfile
import io

def merge_pdfs_hybrid(input_data):
    from pypdf import PdfReader, PdfWriter
    from pypdf.generic import NameObject, StreamObject
    try:
        import fitz
        from PIL import Image
        has_fitz = True
    except ImportError:
        has_fitz = False

    items = input_data.get('items', [])
    raw_output = input_data.get('outputPath')
    resize_to_fit = input_data.get('resizeToFit', False)
    meta_data = input_data.get('metadata', {})
    export_options = input_data.get('exportOptions', {})
    
    A4_WIDTH = 595.0

    output_path = raw_output
    if isinstance(raw_output, dict):
        if raw_output.get('canceled'):
            return
        output_path = raw_output.get('filePath', raw_output.get('filePaths', [''])[0])

    mode = export_options.get('mode', 'merge')
    optimize = export_options.get('optimize', False)
    target_dpi = export_options.get('targetDpi', 150)
    trigger_dpi = export_options.get('triggerDpi', 300)
    fmt = export_options.get('format', 'pdf')

    def optimize_pdf_fitz(src_path, page_idx, target_dpi, trigger_dpi):
        """Downsamples images using PyMuPDF+Pillow and returns path to optimized temp PDF."""
        doc = fitz.open(src_path)
        new_doc = fitz.open()
        new_doc.insert_pdf(doc, from_page=page_idx, to_page=page_idx)
        page = new_doc[0]
        
        for img_info in page.get_images():
            xref = img_info[0]
            smask = img_info[1]
            
            # CRITICAL FIX: Downscaling an RGB image while leaving its SMask intact causes severe corruption.
            # Additionally, flattening Alpha channels into JPEGs obscures underlying vector data.
            # We skip optimizing transparent images entirely to preserve document integrity.
            if smask > 0:
                continue
                
            pix = fitz.Pixmap(new_doc, xref)
            if pix.alpha:
                continue
                
            if pix.n - pix.alpha > 3:
                pix = fitz.Pixmap(fitz.csRGB, pix)
            
            rects = page.get_image_rects(xref)
            if not rects:
                continue
            rect = rects[0]
            
            visual_dpi = (pix.width / rect.width) * 72
            
            scale = target_dpi / visual_dpi
            if scale < 1.0:
                new_w = int(pix.width * scale)
                new_h = int(pix.height * scale)
                
                img_data = pix.tobytes("png")
                img = Image.open(io.BytesIO(img_data))
                
                if img.mode in ("RGBA", "P"):
                    img = img.convert("RGB")
                    
                img = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
                
                out = io.BytesIO()
                img.save(out, format="JPEG", quality=85)
                
                # Replace the image safely using PyMuPDF's built-in method
                page.replace_image(xref, stream=out.getvalue())
                
        fd, temp_path = tempfile.mkstemp(suffix=".pdf")
        os.close(fd)
        new_doc.save(temp_path, garbage=4, deflate=True)
        new_doc.close()
        doc.close()
        return temp_path

    def process_group(group_items, group_output_path):
        writer = PdfWriter()
        temp_files_to_delete = []

        try:
            for item in group_items:
                file_path = item.get('path')
                page_index = int(item.get('originalIndex', 0))
                
                try:
                    rotation = int(item.get('rot', 0))
                except (ValueError, TypeError):
                    rotation = 0
                
                if not file_path or not os.path.exists(file_path):
                    continue

                # 1. OPTIMIZE with PyMuPDF
                if optimize and has_fitz:
                    try:
                        file_path = optimize_pdf_fitz(file_path, page_index, target_dpi, trigger_dpi)
                        temp_files_to_delete.append(file_path)
                        page_index = 0
                    except Exception as e:
                        print(f"Fitz optimization failed for {file_path}: {e}", file=sys.stderr)

                # 2. Add to PyPDF Writer for Final Export
                try:
                    reader = PdfReader(file_path, strict=False)
                    if page_index >= len(reader.pages):
                        continue
                        
                    source_page = reader.pages[page_index]
                    new_page = writer.add_page(source_page)
                    
                    if rotation != 0:
                        new_page.rotate(rotation)
                    
                    if resize_to_fit:
                        try:
                            current_rot = int(getattr(new_page, 'rotation', new_page.get('/Rotate', 0)))
                        except Exception:
                            current_rot = 0
                            
                        is_swapped = (current_rot / 90) % 2 != 0
                        pw = float(new_page.mediabox.width)
                        ph = float(new_page.mediabox.height)
                        visual_width = ph if is_swapped else pw
                        
                        if visual_width > 0 and abs(visual_width - A4_WIDTH) > 1.0:
                            scale = A4_WIDTH / visual_width
                            new_page.scale_by(scale)
                except Exception as e:
                    print(f"Error merging {file_path} page {page_index}: {e}", file=sys.stderr)

            # 3. METADATA & FORMAT INJECTION
            writer_meta = {}
            if meta_data.get('title'): writer_meta["/Title"] = meta_data['title']
            if meta_data.get('author'): writer_meta["/Author"] = meta_data['author']
            writer_meta["/Producer"] = "Combine+ Exporter"
            
            writer.add_metadata(writer_meta)
            
            # XMP Metadata Injection for PDF/A
            if fmt.startswith('pdfa-'):
                part = "2"
                conformance = "B"
                
                if fmt != 'pdfa-auto':
                    # Extract part and conformance from string like 'pdfa-1b', 'pdfa-3u', 'pdfa-4e'
                    sub = fmt[5:]
                    if len(sub) > 0:
                        part = sub[0]
                    if len(sub) > 1:
                        conformance = sub[1:].upper()
                    else:
                        conformance = ""
                
                conf_tag = f"\n      <pdfaid:conformance>{conformance}</pdfaid:conformance>" if conformance else ""
                
                xmp = f"""<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
      <pdfaid:part>{part}</pdfaid:part>{conf_tag}
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>"""
                
                metadata_stream = StreamObject()
                metadata_stream._data = xmp.encode('utf-8')
                metadata_stream.update({
                    NameObject("/Type"): NameObject("/Metadata"),
                    NameObject("/Subtype"): NameObject("/XML")
                })
                meta_obj = writer._add_object(metadata_stream)
                writer._root_object.update({
                    NameObject("/Metadata"): meta_obj
                })
                
            elif fmt.startswith('pdfx-'):
                version = "PDF/X-1a:2001"
                if fmt == 'pdfx-3': version = "PDF/X-3:2002"
                elif fmt == 'pdfx-4': version = "PDF/X-4"
                
                xmp = f"""<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="" xmlns:pdfx="http://ns.adobe.com/pdfx/1.3/" xmlns:pdfxid="http://www.npes.org/pdfx/ns/id/">
      <pdfx:GTS_PDFXVersion>{version}</pdfx:GTS_PDFXVersion>
      <pdfxid:GTS_PDFXVersion>{version}</pdfx:GTS_PDFXVersion>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>"""
                
                metadata_stream = StreamObject()
                metadata_stream._data = xmp.encode('utf-8')
                metadata_stream.update({
                    NameObject("/Type"): NameObject("/Metadata"),
                    NameObject("/Subtype"): NameObject("/XML")
                })
                meta_obj = writer._add_object(metadata_stream)
                writer._root_object.update({
                    NameObject("/Metadata"): meta_obj
                })
            
            with open(group_output_path, 'wb') as f:
                writer.write(f)
                
        finally:
            for tf in temp_files_to_delete:
                if os.path.exists(tf):
                    try:
                        os.remove(tf)
                    except:
                        pass

    if mode == 'batch':
        groups = {}
        for it in items:
            name = it.get('parentName', 'Merged Document.pdf')
            if name not in groups: groups[name] = []
            groups[name].append(it)
            
        if not os.path.exists(output_path):
            os.makedirs(output_path)
            
        for name, group_items in groups.items():
            base_name = os.path.splitext(name)[0]
            out_file = os.path.join(output_path, f"{base_name}_exported.pdf")
            process_group(group_items, out_file)
    else:
        process_group(items, output_path)

if __name__ == "__main__":
    try:
        if len(sys.argv) < 2:
            print(json.dumps({"success": False, "error": "No input data provided"}))
            sys.exit(1)

        input_str = sys.argv[1]
        data = json.loads(input_str)
        
        merge_pdfs_hybrid(data)
        
        print(json.dumps({"success": True}))
        
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)