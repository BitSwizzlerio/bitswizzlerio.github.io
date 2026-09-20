"""Web copy of Joule.glb: textures capped at MAX px, WebP, Draco."""
import bpy, sys, os
argv = sys.argv[sys.argv.index("--")+1:]
src_dir, MAX = argv[0], int(argv[1])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(src_dir, "Joule.glb"))
for img in bpy.data.images:
    w, h = img.size
    if w == 0: continue
    print("IMG", img.name, w, "x", h, "->", end=" ")
    if max(w, h) > MAX:
        s = MAX / max(w, h); img.scale(int(w * s), int(h * s))
    print(img.size[0], "x", img.size[1])
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=os.path.join(src_dir, "Joule_web.glb"), export_format='GLB',
    export_apply=True, use_selection=True, export_yup=True, export_animations=False,
    export_image_format='WEBP', export_image_quality=88,
    export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6)
print("EXPORTED Joule_web.glb")
