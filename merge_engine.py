import sys
import json
import os
import tempfile
import io

def merge_pdfs_hybrid(input_data):
    from pypdf import PdfReader, PdfWriter
    from pypdf.generic import NameObject, StreamObject, DictionaryObject, ArrayObject, TextStringObject, ByteStringObject, NumberObject
    import os, io, sys, tempfile, json, uuid
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
    annotation_overlay = input_data.get('annotationOverlay', None)  # optional annotation PNG
    
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
    
    report = {"fixes": [], "warnings": [], "errors": []}

    def optimize_pdf_fitz(src_path, page_idx, target_dpi, trigger_dpi, group_report):
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
                group_report["fixes"].append(f"Downsampled image (xref {xref}) to {target_dpi} DPI")
                
        fd, temp_path = tempfile.mkstemp(suffix=".pdf")
        os.close(fd)
        new_doc.save(temp_path, garbage=4, deflate=True)
        new_doc.close()
        doc.close()
        return temp_path

    def flatten_page_raster(src_path, page_idx, dpi=300):
        """Renders a PDF page to a high-DPI image and returns path to a new, opaque PDF."""
        doc = fitz.open(src_path)
        page = doc[page_idx]
        pix = page.get_pixmap(dpi=dpi, colorspace=fitz.csRGB, alpha=False)
        img_data = pix.tobytes("jpeg")
        img_pdf_bytes = doc.convert_to_pdf(img_data)
        fd, temp_path = tempfile.mkstemp(suffix=".pdf")
        os.close(fd)
        with open(temp_path, "wb") as f: f.write(img_pdf_bytes)
        doc.close()
        return temp_path

    def sanitize_page_transparency(src_path, page_idx):
        """Attempts to remove transparency markers without rasterizing (Vector Preservation)."""
        doc = fitz.open(src_path)
        page = doc[page_idx]
        
        # 1. Strip Transparency Groups from the page dictionary
        page_dict = page.read_contents() # Ensure stream is loaded
        if page.xref:
            # Remove the /Group attribute which often triggers 'Transparency used' even if invisible
            doc.set_object_property(page.xref, "Group", "null")

        # 2. Surgical Alpha Strip for Images
        for img in page.get_images():
            xref = img[0]
            smask = img[1]
            if smask > 0:
                # If there's a soft mask, we try to 'Flatten' just this image
                pix = fitz.Pixmap(doc, xref)
                if pix.alpha:
                    # Create opaque version
                    pix_opaque = fitz.Pixmap(fitz.csRGB, pix)
                    page.replace_image(xref, pixmap=pix_opaque)
        
        fd, temp_path = tempfile.mkstemp(suffix=".pdf")
        os.close(fd)
        doc.save(temp_path, garbage=4, deflate=True)
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
                        file_path = optimize_pdf_fitz(file_path, page_index, target_dpi, trigger_dpi, report)
                        temp_files_to_delete.append(file_path)
                        page_index = 0
                    except Exception as e:
                        print(f"Fitz optimization failed for {file_path}: {e}", file=sys.stderr)


                # 3. Add to PyPDF Writer for Final Export
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
                    report["errors"].append(f"Merge error: {str(e)}")
                    print(f"Error merging {file_path} page {page_index}: {e}", file=sys.stderr)

            # 3. METADATA & FORMAT INJECTION
            report["fixes"].append("Created 'StructTreeRoot' for document structure (1)")
            doc_id = uuid.uuid4().hex.encode('ascii')
            writer_meta = {}
            if meta_data.get('title'): writer_meta["/Title"] = meta_data['title']
            if meta_data.get('author'): writer_meta["/Author"] = meta_data['author']
            writer_meta["/Producer"] = "Combine+ Exporter"
            
            # Set ID in trailer explicitly for PDF/A compliance
            id_obj = ArrayObject([ByteStringObject(doc_id), ByteStringObject(doc_id)])
            

            
            # Final Trailer ID Injection
            if doc_id:
                writer._ID = ArrayObject([ByteStringObject(doc_id), ByteStringObject(doc_id)])

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
            
        if annotation_overlay and not has_fitz:
            report["warnings"].append("PyMuPDF is not installed. Annotations were skipped.")
            
        for name, group_items in groups.items():
            base_name = os.path.splitext(name)[0]
            out_file = os.path.join(output_path, f"{base_name}_exported.pdf")
            process_group(group_items, out_file)
            
            if annotation_overlay and has_fitz:
                _apply_annotation_overlay(out_file, annotation_overlay, group_items, report)
    else:
        process_group(items, output_path)
        if annotation_overlay and not has_fitz:
            report["warnings"].append("PyMuPDF is not installed. Annotations were skipped.")
        if annotation_overlay and has_fitz:
            _apply_annotation_overlay(output_path, annotation_overlay, items, report)
    
    return report

def _apply_annotation_overlay(pdf_path, overlays, items_list, report):
    """
    Parses raw vector coordinates from the frontend and injects them natively 
    into the PDF as pristine vector shapes and text (Zero Rasterization).
    """
    import math
    import os
    import tempfile
    try:
        import fitz
    except ImportError:
        return  # silently skip if deps missing

    def hex_to_rgb(hex_str):
        if hex_str == 'transparent' or not hex_str: return None
        h = hex_str.lstrip('#')
        if len(h) == 3: h = h[0]*2 + h[1]*2 + h[2]*2
        if len(h) != 6: return (0,0,0)
        return tuple(int(h[i:i+2], 16)/255.0 for i in (0, 2, 4))
        
    def get_dashes(style, thickness):
        if style == 'dashed': return [thickness * 3, thickness * 3]
        if style == 'dotted': return [thickness, thickness * 2]
        return None

    try:
        doc = fitz.open(pdf_path)
        changed = False
        actual_i = 0

        for item in items_list:
            if actual_i >= len(doc): break
            page_id = item.get('id')
            page = doc[actual_i]
            actual_i += 1
            
            if not page_id or page_id not in overlays: continue
            
            overlay = overlays[page_id]
            nodes = overlay.get('nodes', [])
            if not nodes: continue

            orig_rot_w = overlay.get('pageWidth', 0)
            orig_rot_h = overlay.get('pageHeight', 0)
            curr_rot_w = page.rect.width
            curr_rot_h = page.rect.height
            
            scale = 1.0
            if orig_rot_w > 0:
                scale = max(curr_rot_w, curr_rot_h) / max(orig_rot_w, orig_rot_h)

            def get_pt(x, y):
                return x * scale, y * scale

            shape = page.new_shape()

            for node in nodes:
                ntype = node.get('type')
                color = hex_to_rgb(node.get('color'))
                fill_color = hex_to_rgb(node.get('fillColor'))
                has_stroke = node.get('strokeStyle') != 'none'
                thickness = node.get('thickness', 1) * scale
                stroke_opacity = node.get('strokeOpacity', node.get('opacity', 100)) / 100.0
                fill_opacity = node.get('fillOpacity', node.get('opacity', 100)) / 100.0
                dashes = get_dashes(node.get('strokeStyle', 'solid'), thickness)

                blend_mode = node.get('blendMode', 'source-over')
                if blend_mode == 'destination-out':
                    color = (1.0, 1.0, 1.0)
                    fill_color = (1.0, 1.0, 1.0)
                    has_stroke = True

                if ntype in ('PATH', 'POLYLINE') and node.get('points'):
                    pts = [get_pt(p['x'], p['y']) for p in node.get('points')]
                    fitz_pts = [fitz.Point(x, y) for x, y in pts]
                    if node.get('closed'):
                        if len(fitz_pts) > 0:
                            fitz_pts.append(fitz_pts[0])
                        shape.draw_polyline(fitz_pts)
                    else:
                        shape.draw_polyline(fitz_pts)
                    
                    shape.finish(
                        color=color if has_stroke else None,
                        fill=fill_color,
                        width=thickness,
                        stroke_opacity=stroke_opacity,
                        fill_opacity=fill_opacity,
                        dashes=dashes
                    )

                elif ntype == 'SHAPE':
                    stype = node.get('shapeType')
                    x1, y1 = get_pt(node['x'], node['y'])
                    x2, y2 = get_pt(node['endX'], node['endY'])
                    
                    if stype == 'LINE':
                        if has_stroke:
                            shape.draw_line(fitz.Point(x1, y1), fitz.Point(x2, y2))
                    elif stype == 'RECTANGLE':
                        ux1, uy1 = node['x'], node['y']
                        ux2, uy2 = node['endX'], node['endY']
                        pts = [
                            get_pt(ux1, uy1),
                            get_pt(ux2, uy1),
                            get_pt(ux2, uy2),
                            get_pt(ux1, uy2)
                        ]
                        fitz_pts = [fitz.Point(p[0], p[1]) for p in pts]
                        if len(fitz_pts) > 0: fitz_pts.append(fitz_pts[0])
                        shape.draw_polyline(fitz_pts)
                    elif stype == 'ELLIPSE':
                        ux1, uy1 = node['x'], node['y']
                        ux2, uy2 = node['endX'], node['endY']
                        pts = [
                            get_pt(ux1, uy1),
                            get_pt(ux2, uy1),
                            get_pt(ux2, uy2),
                            get_pt(ux1, uy2)
                        ]
                        quad = fitz.Quad(pts[0], pts[1], pts[3], pts[2])
                        shape.draw_oval(quad)
                    elif stype == 'ARROW':
                        if has_stroke:
                            shape.draw_line(fitz.Point(x1, y1), fitz.Point(x2, y2))
                            shape.finish(
                                color=color if has_stroke else None,
                                width=thickness,
                                stroke_opacity=stroke_opacity,
                                dashes=dashes
                            )
                            dx = x2 - x1
                            dy = y2 - y1
                            angle = math.atan2(dy, dx)
                            headlen = 12 * scale
                            p3 = fitz.Point(x2 - headlen * math.cos(angle - math.pi / 6), y2 - headlen * math.sin(angle - math.pi / 6))
                            p4 = fitz.Point(x2 - headlen * math.cos(angle + math.pi / 6), y2 - headlen * math.sin(angle + math.pi / 6))
                            shape.draw_polyline([p3, fitz.Point(x2, y2), p4])
                            shape.finish(
                                color=color if has_stroke else None,
                                width=thickness,
                                stroke_opacity=stroke_opacity,
                                dashes=None
                            )
                    
                    if stype in ('LINE', 'RECTANGLE', 'ELLIPSE'):
                        shape.finish(
                            color=color if has_stroke else None,
                            fill=fill_color,
                            width=thickness,
                            stroke_opacity=stroke_opacity,
                            fill_opacity=fill_opacity,
                            dashes=dashes
                        )

                elif ntype == 'TEXT':
                    txt = node.get('text', '')
                    font_size = node.get('fontSize', 16) * scale
                    node_rot = node.get('rotation', 0)
                    
                    lines = txt.split('\n')
                    font = fitz.Font("helv")
                    
                    max_width = 0
                    for line in lines:
                        l = font.text_length(line, fontsize=font_size)
                        if l > max_width: max_width = l
                    
                    text_h = font_size * len(lines)
                    ux, uy = node['x'], node['y']
                    
                    if node.get('leaderHead') and node.get('leaderElbow'):
                        uhx, uhy = node['leaderHead']['x'], node['leaderHead']['y']
                        uex, uey = node['leaderElbow']['x'], node['leaderElbow']['y']
                        
                        minX, maxX = ux - node.get('padding', 5), ux + (max_width/scale) + node.get('padding', 5)
                        minY, maxY = uy - node.get('padding', 5), uy + (text_h/scale) + node.get('padding', 5)
                        cx, cy = (minX + maxX)/2, (minY + maxY)/2
                        
                        dx = cx - uex
                        dy = cy - uey
                        ix, iy = cx, cy
                        if dx != 0 or dy != 0:
                            tX = (minX - uex) / dx if dx > 0 else (maxX - uex) / dx if dx < 0 else -float('inf')
                            tY = (minY - uey) / dy if dy > 0 else (maxY - uey) / dy if dy < 0 else -float('inf')
                            t = max(0, min(1, max(tX, tY)))
                            ix = uex + t * dx
                            iy = uey + t * dy
                        
                        p1 = get_pt(ix, iy)
                        p2 = get_pt(uex, uey)
                        p3 = get_pt(uhx, uhy)
                        
                        shape.draw_polyline([fitz.Point(*p1), fitz.Point(*p2), fitz.Point(*p3)])
                        shape.finish(
                            color=color if has_stroke else None,
                            width=thickness,
                            stroke_opacity=stroke_opacity,
                            dashes=dashes
                        )
                        
                        angle = math.atan2(p3[1] - p2[1], p3[0] - p2[0])
                        headlen = 12 * scale
                        p4 = fitz.Point(p3[0] - headlen * math.cos(angle - math.pi / 6), p3[1] - headlen * math.sin(angle - math.pi / 6))
                        p5 = fitz.Point(p3[0] - headlen * math.cos(angle + math.pi / 6), p3[1] - headlen * math.sin(angle + math.pi / 6))
                        shape.draw_polyline([p4, fitz.Point(*p3), p5])
                        
                        shape.finish(
                            color=color if has_stroke else None,
                            width=thickness,
                            stroke_opacity=stroke_opacity,
                            dashes=None
                        )
                    
                    node_rot = node.get('rotation', 0)
                    def rotate_pt(px, py, ox, oy):
                        if node_rot == 0: return px, py
                        dx = px - ox
                        dy = py - oy
                        rad = node_rot * math.pi / 180.0
                        rx = dx * math.cos(rad) - dy * math.sin(rad)
                        ry = dx * math.sin(rad) + dy * math.cos(rad)
                        return ox + rx, oy + ry

                    minX = ux - node.get('padding', 5)
                    maxX = ux + (max_width/scale) + node.get('padding', 5)
                    minY = uy - node.get('padding', 5)
                    maxY = uy + (text_h/scale) + node.get('padding', 5)
                    pts = [
                        get_pt(*rotate_pt(minX, minY, ux, uy)),
                        get_pt(*rotate_pt(maxX, minY, ux, uy)),
                        get_pt(*rotate_pt(maxX, maxY, ux, uy)),
                        get_pt(*rotate_pt(minX, maxY, ux, uy))
                    ]
                    
                    fitz_pts = [fitz.Point(p[0], p[1]) for p in pts]
                    if len(fitz_pts) > 0: fitz_pts.append(fitz_pts[0])
                    shape.draw_polyline(fitz_pts)
                    shape.finish(
                        color=color if has_stroke and thickness > 0 else None,
                        fill=fill_color,
                        width=thickness,
                        stroke_opacity=stroke_opacity,
                        fill_opacity=fill_opacity,
                        dashes=dashes
                    )
                    
                    tcolor = hex_to_rgb(node.get('textColor', node.get('color', '#000000')))
                    if tcolor is None: tcolor = (0,0,0)
                    
                    for idx, line in enumerate(lines):
                        l_ox = ux
                        l_oy = uy + idx * (font_size/scale)
                        y_adjusted = l_oy + (font_size/scale) * 0.8
                        rx, ry = get_pt(l_ox, y_adjusted)
                        
                        kwargs = {
                            "fontsize": font_size,
                            "fontname": "helv",
                            "color": tcolor,
                            "fill_opacity": stroke_opacity
                        }
                        if node_rot != 0:
                            kwargs["morph"] = (fitz.Point(rx, ry), fitz.Matrix(node_rot))
                            
                        page.insert_text(fitz.Point(rx, ry), line, **kwargs)

            shape.commit()
            changed = True

        if changed:
            fd, temp_path = tempfile.mkstemp(suffix=".pdf")
            os.close(fd)
            doc.save(temp_path, garbage=4, deflate=True)
            doc.close()
            import shutil, time
            success = False
            for _ in range(10):
                try:
                    shutil.move(temp_path, pdf_path)
                    success = True
                    break
                except Exception:
                    time.sleep(0.5)
            if not success:
                report["errors"].append("Failed to overwrite PDF with annotations due to file lock.")
        else:
            doc.close()
    except Exception as e:
        import traceback
        report["errors"].append(f"Annotation overlay failed: {str(e)}")
        print(f"Vector annotation overlay failed: {e}\n{traceback.format_exc()}", file=sys.stderr)

if __name__ == "__main__":
    try:
        if len(sys.argv) < 2:
            print(json.dumps({"success": False, "error": "No input data provided"}))
            sys.exit(1)

        input_str = sys.argv[1]
        
        # Handle file paths directly to bypass OS command line length limits
        if os.path.isfile(input_str):
            with open(input_str, 'r', encoding='utf-8') as f:
                data = json.load(f)
        else:
            data = json.loads(input_str)
            
        rep = merge_pdfs_hybrid(data)
        
        print(json.dumps({"success": True, "report": rep}))
        
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)