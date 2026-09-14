import os, io, base64, urllib.request, json, traceback, sys
from datetime import datetime
# pyrefly: ignore [missing-import]
from flask import Flask, render_template, request, jsonify, send_from_directory
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops

from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()
app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 20 * 1024 * 1024
# Never let the browser cache static assets — always serve the latest CSS/JS.
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0

def asset_version():
    """Return a cache-busting token based on the newest static file mtime."""
    latest = 0
    static_dir = os.path.join(os.path.dirname(__file__), 'static')
    for root, _dirs, files in os.walk(static_dir):
        for f in files:
            try:
                latest = max(latest, int(os.path.getmtime(os.path.join(root, f))))
            except OSError:
                pass
    return latest or 1

@app.after_request
def add_no_cache_headers(resp):
    # Never cache static assets OR the HTML page, so a refresh always pulls the
    # latest CSS/JS (and the latest cache-busting ?v= token).
    ctype = resp.headers.get('Content-Type', '')
    if request.path.startswith('/static/') or ctype.startswith('text/html'):
        resp.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
        resp.headers['Pragma'] = 'no-cache'
        resp.headers['Expires'] = '0'
    return resp

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
MODEL = os.getenv("GPT_IMAGE_MODEL", "gpt-image-2")
QUALITY = os.getenv("GPT_IMAGE_QUALITY", "low")
TEXT_MODEL = os.getenv("GPT_TEXT_MODEL", "gpt-4o-mini")

def resize_img(img, max_dim=1800):
    w, h = img.size
    if max(w, h) <= max_dim:
        return img
    s = max_dim / max(w, h)
    return img.resize((int(w*s), int(h*s)), Image.LANCZOS)

def hex_rgb(hx):
    hx = hx.lstrip('#')
    return tuple(int(hx[i:i+2], 16) for i in (0, 2, 4))

def load_font(size):
    for fp in [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    ]:
        if os.path.exists(fp):
            try: return ImageFont.truetype(fp, size)
            except: pass
    return ImageFont.load_default()

def log_error(context: str, exc: Exception):
    """Print full error details to the terminal. Never leaks to the frontend."""
    ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    print(f"\n{'='*60}", file=sys.stderr)
    print(f"[{ts}] ERROR in {context}", file=sys.stderr)
    traceback.print_exc(file=sys.stderr)
    print(f"{'='*60}\n", file=sys.stderr, flush=True)

def safe_error(context: str, exc: Exception, http_code: int = 500):
    """Log full error to terminal; return a generic message to the client."""
    log_error(context, exc)
    return jsonify({'error': 'Something went wrong. Please try again.',
                    'success': False}), http_code

def draw_number_badges(base_rgba, markers):
    """Burn numbered circular badges onto an RGBA image at each marker point."""
    W, H = base_rgba.size
    overlay = Image.new('RGBA', base_rgba.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    # Badge radius: match canvas pin formula — imgW/75, clamped 14–28px scaled to full image
    # Canvas uses: max(14, min(imgW/75, 28)) at *displayed* size.
    # At full image resolution we scale the same ratio by (W / displayed_canvas_width).
    # Since we don't know display width here, use a fixed fraction: W/95, min 16, max 36.
    fsz = max(16, min(W // 95, 36))
    font = load_font(fsz)
    for m in markers:
        r, g, b = hex_rgb(m.get('color', '#FF6B6B'))
        cx, cy = int(m['x']), int(m['y'])
        rad = fsz
        # Drop-shadow circle
        shadow_offset = max(2, rad // 12)
        draw.ellipse([cx - rad + shadow_offset, cy - rad + shadow_offset,
                      cx + rad + shadow_offset, cy + rad + shadow_offset],
                     fill=(0, 0, 0, 60))
        # Filled circle
        draw.ellipse([cx - rad, cy - rad, cx + rad, cy + rad], fill=(r, g, b, 245))
        # White border
        border = max(2, rad // 10)
        draw.ellipse([cx - rad, cy - rad, cx + rad, cy + rad],
                     outline=(255, 255, 255, 230), width=border)
        # Number — centred using textbbox
        txt = str(m['number'])
        try:
            bb = draw.textbbox((0, 0), txt, font=font)
            tw, th = bb[2] - bb[0], bb[3] - bb[1]
            ty = cy - th // 2 - bb[1]   # subtract top bearing so it's visually centred
        except Exception:
            tw = th = fsz; ty = cy - fsz // 2
        draw.text((cx - tw // 2, ty), txt, font=font, fill=(255, 255, 255, 255))
    return Image.alpha_composite(base_rgba, overlay)

def flood_detect(img, x, y, tol=38, max_side=1000):
    """Detect the surface at point (x, y) by flood-filling outward along pixels
    whose colour is within `tol` of the seed. Returns an 'L' mask (255 = surface)
    at the ORIGINAL image size. Uses only Pillow (no numpy/cv2)."""
    W, H = img.size
    scale = min(1.0, max_side / max(W, H))          # work small for speed
    dw, dh = max(1, int(W * scale)), max(1, int(H * scale))
    small = img.resize((dw, dh), Image.LANCZOS) if scale < 1 else img.copy()
    sx = min(max(int(round(x * scale)), 0), dw - 1)
    sy = min(max(int(round(y * scale)), 0), dh - 1)

    work = small.copy()
    # Fill the connected region around the seed with a sentinel colour.
    ImageDraw.floodfill(work, (sx, sy), (1, 254, 2), thresh=tol)
    # Anything that changed is the detected region.
    mask = ImageChops.difference(small, work).convert('L').point(lambda v: 255 if v > 0 else 0)
    # Morphological close (bridge grout lines / texture gaps) then open (despeckle).
    mask = mask.filter(ImageFilter.MaxFilter(7)).filter(ImageFilter.MinFilter(7))
    mask = mask.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3))
    # Back to full resolution with a crisp (binary) edge.
    mask = mask.resize((W, H), Image.LANCZOS).point(lambda v: 255 if v >= 128 else 0)
    return mask

WALLSTICKER_DIR = os.path.join(os.path.dirname(__file__), 'wallstickers')
VIDEOS_DIR = os.path.join(os.path.dirname(__file__), 'templates', 'videos')

@app.route('/')
def index():
    return render_template('index.html', v=asset_version())

@app.route('/wallstickers/<path:filename>')
def wallstickers(filename):
    return send_from_directory(WALLSTICKER_DIR, filename)

@app.route('/videos/<path:filename>')
def videos(filename):
    return send_from_directory(VIDEOS_DIR, filename)

@app.route('/assets/<path:filename>')
def assets(filename):
    return send_from_directory(os.path.join(os.path.dirname(__file__), 'templates'), filename)

@app.route('/upload', methods=['POST'])
def upload():
    try:
        img = Image.open(request.files['image'].stream).convert('RGBA')
        img = resize_img(img)
        buf = io.BytesIO()
        img.save(buf, 'PNG')
        return jsonify({'image': base64.b64encode(buf.getvalue()).decode(), 'width': img.width, 'height': img.height})
    except Exception as e:
        return safe_error('upload', e)

@app.route('/detect-region', methods=['POST'])
def detect_region():
    """Given the room image and a clicked point, auto-detect the surface there.
    Body:    { "image": <b64>, "x": <px>, "y": <px>, "tolerance": <int?> }
    Returns: { "mask": <b64 PNG 'L'>, "area_frac": <float>, "success": true }"""
    data = request.json or {}
    try:
        img = Image.open(io.BytesIO(base64.b64decode(data['image']))).convert('RGB')
    except Exception:
        return jsonify({'error': 'Could not read image', 'success': False}), 400
    try:
        x = float(data.get('x', 0)); y = float(data.get('y', 0))
    except (TypeError, ValueError):
        return jsonify({'error': 'Invalid point', 'success': False}), 400
    tol = max(6, min(int(data.get('tolerance', 38)), 120))

    mask = flood_detect(img, x, y, tol)
    hist = mask.resize((200, 200)).histogram()        # cheap area estimate
    area_frac = round(sum(hist[128:]) / (200 * 200), 3)
    buf = io.BytesIO(); mask.save(buf, 'PNG')
    return jsonify({'mask': base64.b64encode(buf.getvalue()).decode(),
                    'area_frac': area_frac, 'success': True})

@app.route('/generate-mask', methods=['POST'])
def generate_mask():
    """Build the annotated preview by drawing numbered badges at each marker.
    Body: { "image": <b64>, "markers": [ {number, x, y, color}, ... ] }"""
    data = request.json
    img = Image.open(io.BytesIO(base64.b64decode(data['image']))).convert('RGBA')
    markers = data.get('markers', data.get('regions', []))
    merged = draw_number_badges(img, markers).convert('RGB')
    buf = io.BytesIO(); merged.save(buf, 'PNG')
    return jsonify({'annotated_image': base64.b64encode(buf.getvalue()).decode()})

@app.route('/parse-prompt', methods=['POST'])
def parse_prompt():
    """Split ONE free-text request into per-region instructions.

    Body:    { "prompt": "region 1 and 3 black, region 2 mustard yellow ...",
               "regions": [1, 2, 3, 4, 5] }
    Returns: { "assignments": [ {"region": 1, "instruction": "paint matte black"}, ... ] }

    So the user can describe every region in a single sentence and we still edit
    each region with only the part that applies to it.
    """
    data = request.json or {}
    prompt = (data.get('prompt') or '').strip()
    regions = data.get('regions') or []
    if not prompt or not regions:
        return jsonify({'assignments': []})

    region_list = ', '.join(str(r) for r in regions)
    system = (
        "You convert a single interior-redesign request into per-region instructions. "
        "Each region is a numbered surface (a wall, floor or ceiling) the user masked. "
        f"The ONLY valid region numbers are: {region_list}. "
        "For every region the user gives an instruction for, output that region's own "
        "instruction as a short imperative describing the colour / material / finish "
        "(e.g. 'paint matte black', 'apply Italian marble', 'mustard-yellow wall with a "
        "leaf and flower pattern'). If one instruction covers several regions (e.g. "
        "'region 1 and 3 black') assign it to each of them. If the user gives a general "
        "instruction with no region number, apply it to ALL listed regions. Never invent "
        "region numbers outside the valid list, and omit regions the user did not mention. "
        'Respond ONLY as JSON of the form: '
        '{"assignments":[{"region":<int>,"instruction":"<text>"}]}'
    )
    try:
        resp = client.chat.completions.create(
            model=TEXT_MODEL,
            messages=[{"role": "system", "content": system},
                      {"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            temperature=0,
        )
        parsed = json.loads(resp.choices[0].message.content)
        valid = set(int(r) for r in regions)
        clean = {}
        for a in parsed.get('assignments', []):
            try:
                rn = int(a.get('region'))
            except (TypeError, ValueError):
                continue
            instr = (a.get('instruction') or '').strip()
            if rn in valid and instr:
                clean[rn] = instr
        ordered = [{'region': int(r), 'instruction': clean[int(r)]}
                   for r in regions if int(r) in clean]
        return jsonify({'assignments': ordered})
    except Exception as e:
        # On any failure, let the caller fall back to applying the raw prompt.
        return jsonify({'assignments': [], 'error': str(e)})

@app.route('/edit', methods=['POST'])
def edit():
    data = request.json
    prompt = data['prompt']
    ref_b64 = data.get('reference_image')

    # ── 1. Load original image (this is what the MODEL sees for context) ─────
    img = Image.open(io.BytesIO(base64.b64decode(data['original_image']))).convert('RGBA')
    w, h = img.size

    # ── 2. Pick optimal API resolution matching image aspect ratio ───────────
    ratio = w / h
    if ratio > 1.2:
        api_w, api_h = 1536, 1024
    elif ratio < 0.8:
        api_w, api_h = 1024, 1536
    else:
        api_w, api_h = 1024, 1024
    size = f"{api_w}x{api_h}"

    # ── MARKER MODE (no segmentation) ────────────────────────────────────────
    #   The user just places numbered pins. We burn those numbers onto the photo
    #   and let the model redesign the surface each number sits on, then remove
    #   the numbers. No mask is used, so this edits the whole image.
    markers = data.get('markers')
    if markers:
        base_src = data.get('base_image') or data['original_image']
        base_img = Image.open(io.BytesIO(base64.b64decode(base_src))).convert('RGBA').resize((w, h))
        annotated = draw_number_badges(base_img, markers).convert('RGB').resize((api_w, api_h), Image.LANCZOS)
        nums = ', '.join(str(m.get('number')) for m in markers)

        # Authoritative colour assignments picked from the palette (optional).
        # Per-region surface type (wall / floor / ceiling) — decides WHAT plane gets edited.
        region_surfaces = data.get('region_surfaces') or {}
        def surf_of(num):
            s = region_surfaces.get(str(num)) or region_surfaces.get(num) or 'wall'
            return str(s).lower()

        region_colors = data.get('region_colors') or {}
        color_lines = []
        for m in markers:
            num = m.get('number')
            c = region_colors.get(str(num)) or region_colors.get(num)
            if c and c.get('hex'):
                color_lines.append(f"Region {num} (the {surf_of(num)}) → paint that {surf_of(num)} {c.get('name','')} ({c.get('hex')})")

        region_stickers = data.get('region_stickers') or {}
        sticker_lines = []
        for m in markers:
            num = m.get('number')
            s = region_stickers.get(str(num)) or region_stickers.get(num)
            if s and s.get('name'):
                desc = s.get('desc') or ''
                sticker_lines.append(f"Region {num} → apply a {s.get('name')} decal onto the {surf_of(num)} ({desc})")

        # Build a single clean instruction line per region.
        region_instructions = []
        for m in markers:
            num = m.get('number')
            surf = surf_of(num)
            c = region_colors.get(str(num)) or region_colors.get(num)
            s = region_stickers.get(str(num)) or region_stickers.get(num)
            if c and c.get('hex'):
                region_instructions.append(
                    f"Badge {num} is on the {surf}. Paint that {surf} {c.get('name','')} ({c.get('hex')}). "
                    f"Do not change any other surface. Especially PILLARS/POLES/any raised surface which are NOT wall."
                )
            elif s and s.get('name'):
                region_instructions.append(
                    f"Badge {num} is on the {surf}. Apply a {s.get('name')} design ({s.get('desc','')}) "
                    f"onto that {surf} only. Do not change any other surface. Especially PILLARS/POLES/any raised surface which are NOT wall."
                )
            elif (prompt or '').strip():
                region_instructions.append(
                    f"Badge {num} is on the {surf}. {(prompt or '').strip()}"
                )

        instructions_text = ' '.join(region_instructions)

        marker_prompt = (
            f"Interior room photo. Numbered badges mark specific surfaces: {nums}. "
            f"{instructions_text} "
            "Rules: "
            "(1) Change ONLY the surface each badge sits on — the exact flat plane at that badge's pixel location. "
            "(2) Each surface plane is independent. A room has left wall, back wall, right wall, ceiling, floor, "
            "and pillar/column faces — all separate. Do not spill onto ANY adjacent plane. "
            "(3) Stop at every visible architectural edge: wall corners, ceiling-wall junctions, floor-wall junctions, "
            "pillar edges, door frames, window frames, partition edges. The colour/design ends there. "
            "(4) Keep all objects in front of the surface (furniture, people, monitors, boards, lights, fixtures) "
            "exactly as they are. Never paint over them. "
            "(5) Remove all numbered badges from the final image. "
            "Photorealistic result, match the room's original perspective and lighting."
        )
        if ref_b64:
            marker_prompt += (" Use the SECOND supplied image only as a material/texture/style reference for the "
                              "requested finishes; do not copy its layout or objects.")

        img_buf = io.BytesIO(); annotated.save(img_buf, 'PNG'); img_buf.seek(0)
        image_list = [("image.png", img_buf, "image/png")]
        all_bufs = [img_buf]
        if ref_b64:
            ref_buf = io.BytesIO()
            Image.open(io.BytesIO(base64.b64decode(ref_b64))).convert('RGB').save(ref_buf, 'PNG'); ref_buf.seek(0)
            image_list.append(("reference.png", ref_buf, "image/png"))
            all_bufs.append(ref_buf)

        # Attach the chosen sticker template image(s) so the exact motif appears.
        sticker_dir = WALLSTICKER_DIR
        sticker_notes = []
        for m in markers:
            s = region_stickers.get(str(m.get('number'))) or region_stickers.get(m.get('number'))
            if not (s and s.get('file')):
                continue
            fpath = os.path.join(sticker_dir, os.path.basename(s['file']))
            if not os.path.exists(fpath):
                continue
            st = Image.open(fpath).convert('RGBA')
            flat = Image.new('RGB', st.size, (255, 255, 255)); flat.paste(st, (0, 0), st)
            sb = io.BytesIO(); flat.save(sb, 'PNG'); sb.seek(0)
            fname = f"sticker_r{m.get('number')}.png"
            image_list.append((fname, sb, "image/png"))
            all_bufs.append(sb)
            sticker_notes.append(f"the supplied image '{fname}' is the EXACT sticker artwork to apply on Region "
                                 f"{m.get('number')} ({s.get('name','')})")
        if sticker_notes:
            marker_prompt += (
                " Sticker reference images supplied: " + "; ".join(sticker_notes) + ". "
                "Apply each sticker's exact motif as a flat vinyl decal on the stated surface, "
                "warped to the surface's perspective. Keep all objects in front — never paint over them."
            )

        image_in = image_list if len(image_list) > 1 else image_list[0]

        try:
            kw = dict(model=MODEL, image=image_in, prompt=marker_prompt, n=1, size=size, quality=QUALITY)
            try:
                resp = client.images.edit(input_fidelity="high", **kw)
            except TypeError:
                resp = client.images.edit(**kw)
            except Exception as e:
                if "input_fidelity" in str(e):
                    for _b in all_bufs: _b.seek(0)
                    resp = client.images.edit(**kw)
                else:
                    raise
            result = resp.data[0]
            if getattr(result, 'b64_json', None):
                ai_bytes = base64.b64decode(result.b64_json)
            else:
                with urllib.request.urlopen(result.url) as r:
                    ai_bytes = r.read()
            final = Image.open(io.BytesIO(ai_bytes)).convert('RGB').resize((w, h), Image.LANCZOS)
            out_buf = io.BytesIO(); final.save(out_buf, 'PNG')
            return jsonify({'output_image': base64.b64encode(out_buf.getvalue()).decode(), 'success': True})
        except Exception as e:
            return safe_error('edit/marker-mode', e)

    # ── 3. Model input + composite base at API resolution ────────────────────
    #   The MODEL always sees the clean original (img_api). The freshly-edited
    #   region is pasted onto `base_api` (the running result), so several regions
    #   accumulate while each is judged against the untouched room.
    img_api = img.convert('RGB').resize((api_w, api_h), Image.LANCZOS)
    base_b64 = data.get('base_image')
    if base_b64:
        base_api = (Image.open(io.BytesIO(base64.b64decode(base_b64)))
                    .convert('RGB').resize((api_w, api_h), Image.LANCZOS))
    else:
        base_api = img_api

    # ── 4. Build the edit mask — from a DETECTED raster mask or a polygon ────
    region_mask_b64 = data.get('region_mask')
    if region_mask_b64:
        # Point-marker flow: the surface was auto-detected into a raster mask.
        region_num = int(data.get('region_num', 1))
        rmask = (Image.open(io.BytesIO(base64.b64decode(region_mask_b64)))
                 .convert('L').resize((api_w, api_h), Image.LANCZOS))
        binm = rmask.point(lambda v: 255 if v >= 128 else 0)
        if not binm.getbbox():
            return jsonify({'error': 'Empty region mask', 'success': False}), 400
        api_mask = Image.new('RGBA', (api_w, api_h), (255, 255, 255, 255))
        api_mask.putalpha(binm.point(lambda v: 0 if v >= 128 else 255))  # 0 = edit here
        comp_mask = binm.filter(ImageFilter.GaussianBlur(radius=1.5))
    else:
        # Legacy polygon flow.
        polys = data['polygons']
        idx = int(data['selected_polygon'])
        if not (0 <= idx < len(polys)):
            return jsonify({'error': 'Invalid polygon index', 'success': False}), 400
        pts = [(p['x'], p['y']) for p in polys[idx]['points']]
        if len(pts) < 3:
            return jsonify({'error': 'Polygon needs at least 3 points', 'success': False}), 400
        region_num = polys[idx].get('number', idx + 1)
        sx, sy = api_w / w, api_h / h
        api_pts = [(px * sx, py * sy) for (px, py) in pts]
        api_mask = Image.new('RGBA', (api_w, api_h), (255, 255, 255, 255))
        ImageDraw.Draw(api_mask).polygon(api_pts, fill=(0, 0, 0, 0))
        comp_sharp = Image.new('L', (api_w, api_h), 0)
        ImageDraw.Draw(comp_sharp).polygon(api_pts, fill=255)
        comp_mask = comp_sharp.filter(ImageFilter.GaussianBlur(radius=1.5))

    # ── 6. Build a tightly-constrained prompt ────────────────────────────────
    ref_clause = (
        "Use the SECOND supplied image purely as a material / texture reference "
        "for this surface: match its pattern, colour, finish and feel, re-projected "
        "onto the wall following the room's exact perspective and lighting. "
        if ref_b64 else ""
    )
    enhanced_prompt = (
        f"Interior room photo. Edit ONLY the masked (transparent) region — Region {region_num}. "
        f"Apply this change to the masked area: \"{prompt}\". "
        f"{ref_clause}"
        "Rules: "
        "(1) Fill the entire masked area with the requested colour/material/design. "
        "(2) Do not alter anything outside the mask — no other wall, floor, ceiling, pillar, or object. "
        "(3) Any object that overlaps the masked area (furniture, fixtures, frames) stays unchanged and "
        "remains in front of the new surface. Never paint over objects. "
        "(4) Stop at every architectural edge within the mask — do not spill onto adjacent planes. "
        "(5) Match the surface's existing perspective, lighting, and shadows. "
        f"Verify: only Region {region_num}'s masked area is changed; everything else is identical to the original."
    )

    # ── 7. Prepare byte buffers (image + mask at API size) ───────────────────
    img_buf = io.BytesIO()
    img_api.save(img_buf, 'PNG')
    img_buf.seek(0)

    mask_buf = io.BytesIO()
    api_mask.save(mask_buf, 'PNG')
    mask_buf.seek(0)

    if ref_b64:
        ref_buf = io.BytesIO()
        Image.open(io.BytesIO(base64.b64decode(ref_b64))).convert('RGB').save(ref_buf, 'PNG')
        ref_buf.seek(0)
        image_in = [("image.png", img_buf, "image/png"),
                    ("reference.png", ref_buf, "image/png")]
    else:
        image_in = ("image.png", img_buf, "image/png")

    try:
        # ── 8. Call OpenAI Image Edit API ────────────────────────────────────
        edit_kwargs = dict(
            model=MODEL, image=image_in,
            mask=("mask.png", mask_buf, "image/png"),
            prompt=enhanced_prompt, n=1, size=size, quality=QUALITY,
        )
        try:
            resp = client.images.edit(input_fidelity="high", **edit_kwargs)
        except TypeError:
            resp = client.images.edit(**edit_kwargs)
        except Exception as e:
            if "input_fidelity" in str(e):
                img_buf.seek(0); mask_buf.seek(0)
                if ref_b64:
                    ref_buf.seek(0)
                resp = client.images.edit(**edit_kwargs)
            else:
                raise

        # ── 9. Decode AI result ──────────────────────────────────────────────
        result = resp.data[0]
        if getattr(result, 'b64_json', None):
            ai_bytes = base64.b64decode(result.b64_json)
        else:
            with urllib.request.urlopen(result.url) as r:
                ai_bytes = r.read()

        # ── 10. Composite AI pixels inside polygon at API size ────────────────
        #   Take the AI's newly-painted region and paste it onto the running base
        #   (which carries any previous regions' edits); everything outside the
        #   polygon stays exactly as it was in the base.
        ai_img = Image.open(io.BytesIO(ai_bytes)).convert('RGBA').resize((api_w, api_h), Image.LANCZOS)
        final_api = Image.composite(ai_img, base_api.convert('RGBA'), comp_mask)

        # ── 11. Scale composited result back to original image size (w, h) ──
        # Inverse scaling (1/sx, 1/sy) guarantees 100.0% sub-pixel exact alignment.
        final = final_api.resize((w, h), Image.LANCZOS)

        out_buf = io.BytesIO()
        final.convert('RGB').save(out_buf, 'PNG')
        return jsonify({'output_image': base64.b64encode(out_buf.getvalue()).decode(), 'success': True})

    except Exception as e:
        return safe_error('edit/mask-mode', e)





if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5001))
    try:
        app.run(debug=True, host='127.0.0.1', port=port)
    except OSError:
        app.run(debug=True, host='127.0.0.1', port=5003)

