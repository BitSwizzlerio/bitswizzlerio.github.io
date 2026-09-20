import bpy, sys, os
argv = sys.argv[sys.argv.index("--")+1:]
src_dir, target = argv[0], int(argv[1])
for name in argv[2:]:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(src_dir, name + ".glb"))
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    total = sum(len(o.data.polygons) for o in meshes)
    ratio = min(1.0, target / max(total, 1))
    print(f"{name}: {len(meshes)} meshes, {total} faces -> ratio {ratio:.3f}")
    for o in meshes:
        bpy.ops.object.select_all(action='DESELECT'); o.select_set(True)
        bpy.context.view_layer.objects.active = o
        # weld duplicate verts first: Decimate deletes faces on unwelded triangle soup
        if 'custom_normal' in o.data.attributes: o.data.attributes.remove(o.data.attributes['custom_normal'])
        bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.mesh.remove_doubles(threshold=1e-5); bpy.ops.mesh.normals_make_consistent(inside=False)
        bpy.ops.object.mode_set(mode='OBJECT')
        if ratio < 1.0 and len(o.data.polygons) > 2000:
            m = o.modifiers.new("Decimate", 'DECIMATE'); m.ratio = ratio; m.use_collapse_triangulate = True
    # smooth shading so decimated sculpts don't render speckled
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.shade_smooth()
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=os.path.join(src_dir, name + "_web.glb"), export_format='GLB',
        export_apply=True, use_selection=True, export_yup=True, export_animations=False,
        export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
        export_draco_position_quantization=14, export_draco_normal_quantization=10, export_draco_texcoord_quantization=12)
    print("EXPORTED", name + "_web.glb")
