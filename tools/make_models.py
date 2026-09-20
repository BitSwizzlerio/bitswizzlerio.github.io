"""
Generate three PBR test models (rusty bucket, teddy bear, robot) as GLB.
Run (from repo root, Windows example):
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup --python tools/make_models.py -- assets/models tools/tex [bucket|teddy|robot]
--factory-startup skips user add-ons (V-Ray kills headless Blender otherwise). Optional trailing names rebuild only those models.
Each model gets procedural textures: baseColor, ORM (occlusion/roughness/metallic), normal.
"""
import bpy, bmesh, sys, os, math
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
OUT_DIR, TEX_DIR = argv[0], argv[1]
os.makedirs(OUT_DIR, exist_ok=True)
os.makedirs(TEX_DIR, exist_ok=True)
TEX = 512

# ----------------------------------------------------------------- noise utils
def fbm(n, octaves=6, seed=0, base=4, gain=0.5):
    rng = np.random.default_rng(seed)
    out = np.zeros((n, n)); amp = 1.0; total = 0.0
    for o in range(octaves):
        g = base * (2 ** o)
        grid = rng.random((g + 1, g + 1))
        grid[-1, :] = grid[0, :]; grid[:, -1] = grid[:, 0]          # tileable
        xs = np.linspace(0, g, n, endpoint=False)
        x0 = np.floor(xs).astype(int); fx = xs - x0
        fx = fx * fx * (3 - 2 * fx)
        a = grid[x0[:, None], x0[None, :]]; b = grid[x0[:, None] + 1, x0[None, :]]
        c = grid[x0[:, None], x0[None, :] + 1]; d = grid[x0[:, None] + 1, x0[None, :] + 1]
        v = (a * (1 - fx[:, None]) + b * fx[:, None]) * (1 - fx[None, :]) + \
            (c * (1 - fx[:, None]) + d * fx[:, None]) * fx[None, :]
        out += amp * v; total += amp; amp *= gain
    return out / total

def normal_from_height(h, strength=4.0):
    dx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * strength
    dy = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * strength
    nx, ny, nz = -dx, -dy, np.ones_like(h)
    l = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx / l, ny / l, nz / l], -1) * 0.5 + 0.5

def lerp(a, b, t): return a + (b - a) * t

def save_image(name, rgb, non_color=False):
    n = rgb.shape[0]
    rgba = np.concatenate([np.clip(rgb, 0, 1), np.ones((n, n, 1))], -1).astype(np.float32)
    img = bpy.data.images.new(name, n, n, alpha=False)
    img.pixels.foreach_set(rgba.ravel())
    img.filepath_raw = os.path.join(TEX_DIR, name + ".png")
    img.file_format = 'PNG'
    img.save()
    img = bpy.data.images.load(img.filepath_raw)
    if non_color: img.colorspace_settings.name = 'Non-Color'
    return img

# ----------------------------------------------------------------- materials
def pbr_material(name, base_img, orm_img, nrm_img, emission=None):
    mat = bpy.data.materials.new(name); mat.use_nodes = True
    nt = mat.node_tree; nodes = nt.nodes; links = nt.links
    bsdf = nodes["Principled BSDF"]
    tb = nodes.new("ShaderNodeTexImage"); tb.image = base_img; tb.location = (-600, 300)
    links.new(tb.outputs["Color"], bsdf.inputs["Base Color"])
    to = nodes.new("ShaderNodeTexImage"); to.image = orm_img; to.location = (-600, 0)
    sep = nodes.new("ShaderNodeSeparateColor"); sep.location = (-300, 0)
    links.new(to.outputs["Color"], sep.inputs["Color"])
    links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
    links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
    tn = nodes.new("ShaderNodeTexImage"); tn.image = nrm_img; tn.location = (-600, -300)
    nm = nodes.new("ShaderNodeNormalMap"); nm.location = (-300, -300)
    links.new(tn.outputs["Color"], nm.inputs["Color"])
    links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*emission[0], 1)
        bsdf.inputs["Emission Strength"].default_value = emission[1]
    return mat

def flat_material(name, color, rough=0.3, metal=0.0, emission=None):
    mat = bpy.data.materials.new(name); mat.use_nodes = True
    b = mat.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emission:
        b.inputs["Emission Color"].default_value = (*emission[0], 1)
        b.inputs["Emission Strength"].default_value = emission[1]
    return mat

# ----------------------------------------------------------------- scene utils
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def smooth(obj, angle=35):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True); bpy.context.view_layer.objects.active = obj
    bpy.ops.object.shade_smooth()
    try:
        bpy.ops.object.shade_auto_smooth(angle=math.radians(angle))
    except Exception:
        try: bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle))
        except Exception: pass

def join(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = name
    return obj

def set_mat(obj, mat):
    obj.data.materials.clear(); obj.data.materials.append(mat)

def export(name):
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(OUT_DIR, name + ".glb"),
        export_format='GLB', export_apply=True, use_selection=True,
        export_yup=True, export_image_format='AUTO', export_texcoords=True,
        export_normals=True, export_materials='EXPORT', export_animations=False)
    print("EXPORTED", name)

def sphere(r, loc, scale=(1, 1, 1), seg=32, ring=16):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=ring, radius=r, location=loc, scale=scale)
    return bpy.context.active_object

def cube(size, loc, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_cube_add(size=size, location=loc, scale=scale)
    return bpy.context.active_object

def cyl(r, d, loc, rot=(0, 0, 0), verts=32):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=d, location=loc, rotation=rot)
    return bpy.context.active_object

# =================================================================== 1. BUCKET
def build_bucket():
    reset()
    # tapered body, open top
    bpy.ops.mesh.primitive_cone_add(vertices=48, radius1=0.72, radius2=0.95, depth=1.5,
                                    end_fill_type='NGON', location=(0, 0, 0))
    body = bpy.context.active_object
    bm = bmesh.new(); bm.from_mesh(body.data)
    bm.faces.ensure_lookup_table()
    top = [f for f in bm.faces if f.normal.z > 0.9 and len(f.verts) > 8]
    bmesh.ops.delete(bm, geom=top, context='FACES')
    bm.to_mesh(body.data); bm.free()
    sol = body.modifiers.new("Solidify", 'SOLIDIFY'); sol.thickness = 0.035; sol.offset = -1
    # subtle dents via displace-free approach: leave to normal map
    # rim
    bpy.ops.mesh.primitive_torus_add(major_radius=0.96, minor_radius=0.04, major_segments=48, minor_segments=12,
                                     location=(0, 0, 0.75))
    rim = bpy.context.active_object
    # base ring
    bpy.ops.mesh.primitive_torus_add(major_radius=0.73, minor_radius=0.03, major_segments=48, minor_segments=10,
                                     location=(0, 0, -0.74))
    base = bpy.context.active_object
    # handle: half torus standing up
    bpy.ops.mesh.primitive_torus_add(major_radius=1.0, minor_radius=0.03, major_segments=48, minor_segments=10,
                                     location=(0, 0, 0.75), rotation=(math.radians(90), 0, 0))
    handle = bpy.context.active_object
    bm = bmesh.new(); bm.from_mesh(handle.data)
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:],
                           plane_co=(0, 0, 0.02), plane_no=(0, 0, -1), clear_inner=True)
    bm.to_mesh(handle.data); bm.free()
    handle.location.z = 0.75
    # handle lugs
    lug1 = sphere(0.07, (1.0, 0, 0.75)); lug2 = sphere(0.07, (-1.0, 0, 0.75))
    for o in (body, rim, base, handle, lug1, lug2): smooth(o, 40)
    bucket = join([body, rim, base, handle, lug1, lug2], "RustyBucket")
    # UVs: unwrap so the noise reads as surface detail
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.02)
    bpy.ops.object.mode_set(mode='OBJECT')
    bucket.rotation_euler = (0, 0, 0)

    # --- textures: galvanized steel with rust blooming through
    n = TEX
    blotch = fbm(n, 6, seed=1, base=10, gain=0.55)
    speck  = fbm(n, 7, seed=2, base=40, gain=0.6)
    rust_mask = np.clip((blotch - 0.47) * 4.0 + (speck - 0.5) * 1.2, 0, 1)
    grain = fbm(n, 7, seed=3, base=32)
    steel = np.stack([0.55, 0.56, 0.58], -1) * (0.7 + 0.5 * grain)[..., None]
    rust_dark = np.array([0.28, 0.12, 0.05]); rust_bright = np.array([0.62, 0.30, 0.10])
    rust = lerp(rust_dark, rust_bright, fbm(n, 6, seed=4, base=8))[..., None] if False else \
           lerp(rust_dark[None, None], rust_bright[None, None], fbm(n, 6, seed=4, base=8)[..., None])
    base_col = lerp(steel, rust, rust_mask[..., None])
    rough = lerp(0.35 + 0.25 * grain, 0.85 + 0.15 * grain, rust_mask)
    metal = lerp(np.full((n, n), 1.0), np.full((n, n), 0.15), rust_mask)
    orm = np.stack([np.ones((n, n)), rough, metal], -1)
    height = rust_mask * 0.6 + fbm(n, 8, seed=5, base=24) * 0.4
    nrm = normal_from_height(height, 6.0)
    mat = pbr_material("RustySteel",
                       save_image("bucket_baseColor", base_col),
                       save_image("bucket_orm", orm, True),
                       save_image("bucket_normal", nrm, True))
    set_mat(bucket, mat)
    export("bucket")

# =================================================================== 2. TEDDY
def build_teddy():
    reset()
    parts = []
    parts.append(sphere(0.62, (0, 0, -0.35), scale=(1, 0.9, 1.05)))          # body
    parts.append(sphere(0.48, (0, 0, 0.55)))                                 # head
    parts.append(sphere(0.17, (0.36, -0.05, 0.92)))                          # ears
    parts.append(sphere(0.17, (-0.36, -0.05, 0.92)))
    parts.append(sphere(0.20, (0, -0.40, 0.42), scale=(1.2, 0.8, 0.95)))     # muzzle
    for sx in (1, -1):
        parts.append(sphere(0.19, (sx * 0.62, -0.08, -0.05), scale=(1, 1, 1.9)))  # arms
        parts.append(sphere(0.22, (sx * 0.42, -0.15, -0.95), scale=(1.15, 1.2, 1)))  # legs
        parts.append(sphere(0.12, (sx * 0.50, -0.30, -1.05)))                    # paws
    parts.append(sphere(0.26, (0, 0.15, -0.35)))                              # tail-ish back bump
    for p in parts: smooth(p, 60)
    bear = join(parts, "TeddyBear")
    # eyes + nose in glossy plastic (separate material)
    eyes = [sphere(0.06, (0.17, -0.42, 0.62), seg=16, ring=8), sphere(0.06, (-0.17, -0.42, 0.62), seg=16, ring=8),
            sphere(0.075, (0, -0.58, 0.48), scale=(1.2, 0.8, 0.9), seg=16, ring=8)]
    for e in eyes: smooth(e, 80)
    eye = join(eyes, "TeddyEyes")
    set_mat(eye, flat_material("GlossyPlastic", (0.02, 0.015, 0.012), rough=0.12))

    # --- textures: plush fur
    n = TEX
    fuzz = fbm(n, 8, seed=11, base=48, gain=0.6)
    tone = fbm(n, 5, seed=12, base=4)
    col = lerp(np.array([0.72, 0.48, 0.24])[None, None], np.array([0.86, 0.64, 0.36])[None, None], tone[..., None])
    col = col * (0.85 + 0.3 * fuzz)[..., None]
    rough = 0.9 + 0.1 * fuzz
    orm = np.stack([np.ones((n, n)), rough, np.zeros((n, n))], -1)
    nrm = normal_from_height(fuzz * 0.5 + fbm(n, 9, seed=13, base=96) * 0.5, 3.5)
    mat = pbr_material("PlushFur",
                       save_image("teddy_baseColor", col),
                       save_image("teddy_orm", orm, True),
                       save_image("teddy_normal", nrm, True))
    set_mat(bear, mat)
    export("teddy")

# =================================================================== 3. ROBOT
def build_robot():
    reset()
    body_parts = []
    torso = cube(1, (0, 0, 0), scale=(0.8, 0.55, 1.0)); body_parts.append(torso)
    head = cube(1, (0, 0, 0.95), scale=(0.62, 0.5, 0.5)); body_parts.append(head)
    body_parts.append(cyl(0.12, 0.18, (0, 0, 0.6)))                                  # neck
    body_parts.append(cyl(0.025, 0.35, (0, 0, 1.35)))                                # antenna
    for sx in (1, -1):
        body_parts.append(sphere(0.16, (sx * 0.56, 0, 0.38)))                        # shoulders
        body_parts.append(cyl(0.09, 0.6, (sx * 0.56, 0, 0.02)))                      # upper arm
        body_parts.append(sphere(0.11, (sx * 0.56, 0, -0.3)))                        # elbow
        body_parts.append(cyl(0.07, 0.5, (sx * 0.56, 0, -0.58)))                     # forearm
        body_parts.append(cube(1, (sx * 0.56, 0, -0.9), scale=(0.16, 0.14, 0.14)))   # hand
        body_parts.append(cyl(0.11, 0.55, (sx * 0.24, 0, -0.78)))                    # legs
        body_parts.append(cube(1, (sx * 0.24, -0.06, -1.1), scale=(0.24, 0.36, 0.12)))  # feet
    body_parts.append(cube(1, (0, -0.28, 0.05), scale=(0.42, 0.04, 0.32)))          # chest panel
    for p in body_parts:
        bev = p.modifiers.new("Bevel", 'BEVEL'); bev.width = 0.02; bev.segments = 3
        smooth(p, 35)
    robot = join(body_parts, "Robot")
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.02)
    bpy.ops.object.mode_set(mode='OBJECT')

    # glowing bits: eyes, antenna tip, chest light (BitSwizzler yellow)
    glow = [cyl(0.08, 0.06, (0.16, -0.26, 1.0), rot=(math.radians(90), 0, 0), verts=24),
            cyl(0.08, 0.06, (-0.16, -0.26, 1.0), rot=(math.radians(90), 0, 0), verts=24),
            sphere(0.06, (0, 0, 1.55), seg=16, ring=8),
            cyl(0.06, 0.05, (0, -0.31, 0.05), rot=(math.radians(90), 0, 0), verts=24)]
    for g in glow: smooth(g, 60)
    lights = join(glow, "RobotLights")
    set_mat(lights, flat_material("Glow", (1.0, 0.83, 0.0), rough=0.4, emission=((1.0, 0.83, 0.0), 4.0)))
    # dark rubber joints
    joints = [cyl(0.05, 0.12, (0, 0, -0.42)), cyl(0.05, 0.12, (0.2, 0, -0.42))]
    for j in joints: j.hide_viewport = True

    # --- textures: painted metal with panel seams and wear
    n = TEX
    yy, xx = np.mgrid[0:n, 0:n] / n
    seams = ((np.abs((xx * 6) % 1 - 0.5) > 0.47) | (np.abs((yy * 6) % 1 - 0.5) > 0.47)).astype(float)
    wear = np.clip((fbm(n, 7, seed=21, base=6) - 0.55) * 6, 0, 1)
    scratches = fbm(n, 8, seed=22, base=64, gain=0.7)
    paint = np.array([0.13, 0.52, 0.55]); bare = np.array([0.6, 0.6, 0.62])
    col = lerp(paint[None, None], bare[None, None], wear[..., None]) * (0.92 + 0.12 * scratches)[..., None]
    col = col * (1 - 0.5 * seams)[..., None]
    rough = lerp(0.35 + 0.15 * scratches, 0.55 + 0.2 * scratches, wear) + seams * 0.2
    metal = lerp(np.full((n, n), 0.15), np.full((n, n), 1.0), wear)
    orm = np.stack([1 - seams * 0.4, rough, metal], -1)
    height = -seams * 0.8 + wear * 0.15 + scratches * 0.1
    nrm = normal_from_height(height, 5.0)
    mat = pbr_material("PaintedMetal",
                       save_image("robot_baseColor", col),
                       save_image("robot_orm", orm, True),
                       save_image("robot_normal", nrm, True))
    set_mat(robot, mat)
    # remove hidden helper joints before export
    for j in joints: bpy.data.objects.remove(j)
    export("robot")

import sys as _s
only=[a for a in argv[2:]]
if not only or 'bucket' in only: build_bucket()
if not only or 'teddy' in only: build_teddy()
if not only or 'robot' in only: build_robot()
print("ALL DONE")
