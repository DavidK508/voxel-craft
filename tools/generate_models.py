"""Generate low-poly blocky GLB models for every moving entity.

Run with:
    blender --background --python tools/generate_models.py

Coordinates in this file are *game* coordinates (Y up, mob faces -Z). They are
converted to Blender space by to_blender(), so the exported glTF nodes end up
at exactly the same positions as the current procedural models.

Named empty objects (head, leg_0, wing_0, rod_0, ...) become animation pivots
in Three.js. Mesh names carry a material role prefix (skin_, shirt_, ...) so
the player model can repaint them from the character editor.
"""

import bpy
import math
import os

OUT_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "assets", "models")
)
os.makedirs(OUT_DIR, exist_ok=True)


# ---------------------------------------------------------------------------
# Scene helpers
# ---------------------------------------------------------------------------

def clear_scene():
    global _materials
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in list(bpy.data.materials):
        bpy.data.materials.remove(block)
    _materials = {}


def to_blender(point):
    x, y, z = point
    return (x, -z, y)


_materials = {}


def material(color):
    key = "%06x" % (int(color) & 0xFFFFFF)
    if key not in _materials:
        mat = bpy.data.materials.new(name="col_" + key)
        mat.diffuse_color = (
            ((color >> 16) & 255) / 255.0,
            ((color >> 8) & 255) / 255.0,
            (color & 255) / 255.0,
            1.0,
        )
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        if bsdf:
            bsdf.inputs["Base Color"].default_value = mat.diffuse_color
            bsdf.inputs["Roughness"].default_value = 1.0
            bsdf.inputs["Metallic"].default_value = 0.0
        _materials[key] = mat
    return _materials[key]


def empty(name, pos=(0, 0, 0), parent=None):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.location = to_blender(pos)
    obj.empty_display_size = 0.08
    if parent:
        obj.parent = parent
    return obj


def box(name, size, pos, color, parent=None):
    """size is (width, height, depth) in game space."""
    w, h, d = size
    bpy.ops.mesh.primitive_cube_add(size=1, location=to_blender(pos))
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = (w, d, h)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material(color))
    if parent:
        obj.parent = parent
    return obj


def leg(root, index, pos, size, color):
    pivot = empty("leg_%d" % index, pos, root)
    w, h, d = size
    box("legmesh_%d" % index, (w, h, d), (0, -h / 2.0, 0), color, pivot)
    return pivot


def new_model():
    clear_scene()
    return empty("root")


def export(name):
    path = os.path.join(OUT_DIR, name + ".glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB")
    print("EXPORTED", path, flush=True)


# ---------------------------------------------------------------------------
# Shared body builders
# ---------------------------------------------------------------------------

def quadruped(body_color, head_color, leg_color, body_size, leg_height,
              head_size, body_y, head_z, snout=None, ears=None, tail=None,
              mane=None):
    root = new_model()
    bw, bh, bd = body_size
    hw, hh, hd = head_size
    box("body", (bw, bh, bd), (0, body_y, 0), body_color, root)

    head = empty("head", (0, body_y + bh / 2.0 + hh * 0.15, head_z), root)
    box("headmesh", (hw, hh, hd), (0, 0, 0), head_color, head)
    if snout:
        sw, sh, sd, sc = snout
        box("snout", (sw, sh, sd), (0, -hh * 0.18, -hd * 0.62), sc, head)
    if ears:
        box("ear_l", (0.11, 0.22, 0.1), (-hw * 0.3, hh * 0.62, 0), ears, head)
        box("ear_r", (0.11, 0.22, 0.1), (hw * 0.3, hh * 0.62, 0), ears, head)

    index = 0
    for x in (-bw * 0.34, bw * 0.34):
        for z in (-bd * 0.34, bd * 0.34):
            leg(root, index, (x, body_y - bh / 2.0 + leg_height, z),
                (0.2, leg_height, 0.2), leg_color)
            index += 1

    if tail:
        tw, th, td, tc = tail
        box("tail", (tw, th, td), (0, body_y + bh * 0.1, bd * 0.55), tc, root)
    if mane:
        box("mane", (0.16, 0.3, bd * 0.5), (0, body_y + bh / 2.0, head_z * 0.4), mane, root)
    return root, head


def humanoid(root, shirt, pants, skin, head_y=1.58, head_size=0.42):
    """Legs + torso + head pivot + arms for human-like mobs."""
    leg(root, 0, (-0.13, 0.72, 0), (0.18, 0.72, 0.21), pants)
    leg(root, 1, (0.13, 0.72, 0), (0.18, 0.72, 0.21), pants)
    box("torso", (0.52, 0.72, 0.28), (0, 1.08, 0), shirt, root)
    head = empty("head", (0, head_y, 0), root)
    box("headmesh", (head_size, head_size, head_size), (0, 0, 0), skin, head)
    arms = []
    for i, side in enumerate((-1, 1)):
        arm = empty("arm_%d" % i, (side * 0.33, 1.18, 0), root)
        box("armmesh_%d" % i, (0.16, 0.62, 0.18), (0, -0.31, 0), shirt, arm)
        arms.append(arm)
    return head, arms


# ---------------------------------------------------------------------------
# Passive mobs
# ---------------------------------------------------------------------------

def cow():
    root, head = quadruped(
        0x5A3B25, 0x6B4A2F, 0x4B3220,
        (0.9, 0.78, 1.4), 0.5, (0.55, 0.55, 0.55), 0.92, -0.92,
        snout=(0.36, 0.26, 0.22, 0xD9C4B0), ears=0x6B4A2F,
        tail=(0.09, 0.55, 0.09, 0x4B3220),
    )
    box("patch_a", (0.55, 0.5, 0.55), (0.16, 1.04, 0.18), 0xE8E0D0, root)
    box("patch_b", (0.36, 0.34, 0.4), (-0.2, 0.77, -0.28), 0xE8E0D0, root)
    box("horn_l", (0.08, 0.12, 0.08), (-0.18, 0.3, 0), 0xE8E0D0, head)
    box("horn_r", (0.08, 0.12, 0.08), (0.18, 0.3, 0), 0xE8E0D0, head)
    return "cow"


def pig():
    quadruped(
        0xE89AA8, 0xF0AAB8, 0xD88A98,
        (0.78, 0.6, 1.05), 0.34, (0.5, 0.5, 0.5), 0.65, -0.7,
        snout=(0.24, 0.2, 0.18, 0xD97F92), ears=0xE89AA8,
        tail=(0.08, 0.08, 0.08, 0xD88A98),
    )
    return "pig"


def sheep():
    root, _ = quadruped(
        0xF2F0E6, 0xD8CAB4, 0xC8BCA8,
        (0.95, 0.8, 1.15), 0.42, (0.44, 0.46, 0.46), 0.9, -0.66,
        ears=0xD8CAB4, tail=(0.12, 0.16, 0.12, 0xF2F0E6),
    )
    box("wool_l", (0.5, 0.34, 0.7), (-0.3, 1.24, 0.16), 0xF8F6EE, root)
    box("wool_r", (0.5, 0.34, 0.7), (0.3, 1.24, -0.16), 0xF8F6EE, root)
    return "sheep"


def chicken():
    root = new_model()
    box("body", (0.42, 0.4, 0.5), (0, 0.55, 0.05), 0xF4F0E8, root)
    head = empty("head", (0, 0.86, -0.2), root)
    box("headmesh", (0.26, 0.26, 0.26), (0, 0, 0), 0xF4F0E8, head)
    box("beak", (0.12, 0.1, 0.14), (0, -0.02, -0.2), 0xE8A92A, head)
    box("comb", (0.08, 0.14, 0.08), (0, 0.18, 0), 0xD23A2E, head)
    box("wattle", (0.06, 0.1, 0.05), (0, -0.1, -0.12), 0xD23A2E, head)
    for i, side in enumerate((-1, 1)):
        pivot = empty("wing_%d" % i, (side * 0.25, 0.62, 0.02), root)
        box("wingmesh_%d" % i, (0.08, 0.3, 0.4), (0, 0, 0), 0xE8E0D4, pivot)
    leg(root, 0, (-0.1, 0.37, 0.05), (0.06, 0.34, 0.06), 0xE8A92A)
    leg(root, 1, (0.1, 0.37, 0.05), (0.06, 0.34, 0.06), 0xE8A92A)
    return "chicken"


def rabbit():
    root, head = quadruped(
        0xD8CBB8, 0xE4D8C6, 0xC4B6A2,
        (0.36, 0.34, 0.5), 0.16, (0.3, 0.3, 0.3), 0.34, -0.32,
        tail=(0.1, 0.1, 0.1, 0xF4EFE6),
    )
    box("ear_l", (0.08, 0.42, 0.06), (-0.08, 0.3, 0.02), 0xD8CBB8, head)
    box("ear_r", (0.08, 0.42, 0.06), (0.08, 0.3, 0.02), 0xD8CBB8, head)
    return "rabbit"


def horse():
    root, head = quadruped(
        0x7A4B2A, 0x87552F, 0x5C3820,
        (0.85, 0.8, 1.55), 0.72, (0.46, 0.52, 0.95), 1.12, -1.02,
        mane=0x2E1D12, tail=(0.12, 0.6, 0.12, 0x2E1D12),
    )
    box("saddle", (0.32, 0.4, 0.7), (0, 1.55, -0.6), 0x7A4B2A, root)
    box("muzzle", (0.3, 0.22, 0.3), (0, 0.28, 0.1), 0x2E1D12, head)
    return "horse"


def camel():
    root, _ = quadruped(
        0xC9A15F, 0xD4AC6B, 0xB08A4C,
        (0.95, 0.85, 1.75), 0.9, (0.48, 0.5, 0.85), 1.35, -1.12,
        tail=(0.1, 0.45, 0.1, 0xB08A4C),
    )
    box("hump_back", (0.6, 0.42, 0.8), (0, 1.9, 0.05), 0xC9A15F, root)
    box("hump_front", (0.34, 0.5, 0.65), (0, 1.45, -0.75), 0xC9A15F, root)
    return "camel"


def wolf():
    quadruped(
        0x8B8D94, 0x9A9CA3, 0x74767C,
        (0.5, 0.42, 0.85), 0.34, (0.36, 0.34, 0.42), 0.56, -0.52,
        snout=(0.2, 0.16, 0.2, 0x6E7076), ears=0x74767C,
        tail=(0.12, 0.16, 0.4, 0x8B8D94),
    )
    return "wolf"


def fox():
    quadruped(
        0xC96A28, 0xD8772F, 0x4A3324,
        (0.42, 0.36, 0.72), 0.28, (0.34, 0.3, 0.4), 0.48, -0.45,
        snout=(0.16, 0.13, 0.18, 0xF4EFE6), ears=0xB85E22,
        tail=(0.2, 0.2, 0.45, 0xC96A28),
    )
    return "fox"


def bee():
    root = new_model()
    box("body", (0.34, 0.28, 0.46), (0, 0.4, 0), 0xF2C22E, root)
    box("stripe_a", (0.36, 0.29, 0.09), (0, 0.4, -0.1), 0x2C2114, root)
    box("stripe_b", (0.36, 0.29, 0.09), (0, 0.4, 0.13), 0x2C2114, root)
    box("headmesh", (0.22, 0.22, 0.22), (0, 0.42, -0.3), 0x2C2114, root)
    box("stinger", (0.08, 0.08, 0.05), (0, 0.42, -0.44), 0xF2C22E, root)
    for i, side in enumerate((-1, 1)):
        pivot = empty("wing_%d" % i, (side * 0.24, 0.6, 0.02), root)
        box("wingmesh_%d" % i, (0.34, 0.03, 0.22), (0, 0, 0), 0xDFF2FF, pivot)
    return "bee"


def bird():
    root = new_model()
    box("body", (0.26, 0.26, 0.4), (0, 0.42, 0), 0x4A8FD4, root)
    box("headmesh", (0.24, 0.24, 0.24), (0, 0.66, -0.22), 0x5AA0E0, root)
    box("beak", (0.1, 0.08, 0.16), (0, 0.64, -0.4), 0xE8A92A, root)
    for i, side in enumerate((-1, 1)):
        pivot = empty("wing_%d" % i, (side * 0.28, 0.46, -0.02), root)
        box("wingmesh_%d" % i, (0.34, 0.05, 0.26), (0, 0, 0), 0x3B78B8, pivot)
    leg(root, 0, (-0.07, 0.3, 0.02), (0.05, 0.26, 0.05), 0xE8A92A)
    leg(root, 1, (0.07, 0.3, 0.02), (0.05, 0.26, 0.05), 0xE8A92A)
    return "bird"


# ---------------------------------------------------------------------------
# Villagers and hostile mobs
# ---------------------------------------------------------------------------

def villager():
    root = new_model()
    leg(root, 0, (-0.13, 0.72, 0), (0.18, 0.72, 0.21), 0x4A3B2A)
    leg(root, 1, (0.13, 0.72, 0), (0.18, 0.72, 0.21), 0x4A3B2A)
    box("robe", (0.58, 0.72, 0.34), (0, 1.06, 0), 0x6A4A2C, root)
    box("apron", (0.34, 0.56, 0.36), (0, 0.98, -0.02), 0x9B7A4B, root)
    box("belt", (0.6, 0.08, 0.36), (0, 0.78, 0), 0x3F2F20, root)
    box("sash", (0.16, 0.5, 0.04), (0, 1.05, -0.19), 0xB08A5C, root)

    head = empty("head", (0, 1.58, 0), root)
    box("headmesh", (0.42, 0.42, 0.42), (0, 0, 0), 0xC79A6B, head)
    box("nose", (0.13, 0.18, 0.16), (0, -0.03, -0.27), 0xB08A5C, head)
    box("unibrow", (0.44, 0.08, 0.44), (0, 0.22, 0), 0x3A2A1A, head)
    box("beard", (0.36, 0.2, 0.16), (0, -0.25, -0.14), 0xE8E2D2, head)
    for x in (-0.11, 0.11):
        box("eye_dark_%s" % x, (0.1, 0.07, 0.02), (x, 0.04, -0.22), 0x2B211A, head)
        box("brow_%s" % x, (0.12, 0.05, 0.02), (x, 0.11, -0.22), 0x5A3B24, head)
        box("eye_white_%s" % x, (0.06, 0.06, 0.02), (x, 0.04, -0.235), 0xF5F1E6, head)

    for i, side in enumerate((-1, 1)):
        arm = empty("arm_%d" % i, (side * 0.37, 1.35, 0), root)
        box("sleeve_%d" % i, (0.16, 0.42, 0.2), (0, -0.2, 0), 0x7A5A3A, arm)
        box("hand_%d" % i, (0.14, 0.16, 0.18), (0, -0.48, 0), 0xC79A6B, arm)
    return "villager"


def iron_golem():
    root = new_model()
    leg(root, 0, (-0.28, 0.95, 0), (0.34, 0.95, 0.36), 0x9AA09B)
    leg(root, 1, (0.28, 0.95, 0), (0.34, 0.95, 0.36), 0x9AA09B)
    box("torso", (1.0, 0.9, 0.6), (0, 1.55, 0), 0xB8BEB8, root)
    box("waist", (0.72, 0.3, 0.5), (0, 1.18, 0), 0xA8AEA8, root)
    head = empty("head", (0, 2.18, 0), root)
    box("headmesh", (0.46, 0.5, 0.46), (0, 0, 0), 0xC2C8C0, head)
    box("nose", (0.16, 0.2, 0.14), (0, -0.02, -0.3), 0x8F958D, head)
    for x in (-0.11, 0.11):
        box("eye_%s" % x, (0.08, 0.06, 0.02), (x, 0.08, -0.24), 0x373D3B, head)
    for i, side in enumerate((-1, 1)):
        arm = empty("arm_%d" % i, (side * 0.68, 1.4, 0), root)
        box("armmesh_%d" % i, (0.3, 1.3, 0.32), (0, 0, 0), 0xADB3AD, arm)
    box("moss_a", (0.12, 0.5, 0.02), (-0.2, 1.4, -0.31), 0x4A7A3A, root)
    box("moss_b", (0.1, 0.3, 0.02), (0.25, 1.7, -0.31), 0x4A7A3A, root)
    return "iron_golem"


def zombie():
    root = new_model()
    leg(root, 0, (-0.13, 0.72, 0), (0.2, 0.72, 0.22), 0x2C3D6B)
    leg(root, 1, (0.13, 0.72, 0), (0.2, 0.72, 0.22), 0x2C3D6B)
    box("torso", (0.52, 0.72, 0.28), (0, 1.08, 0), 0x2F8F6A, root)
    head = empty("head", (0, 1.6, 0), root)
    box("headmesh", (0.44, 0.44, 0.44), (0, 0, 0), 0x3F9A72, head)
    for x in (-0.1, 0.1):
        box("eye_%s" % x, (0.08, 0.06, 0.02), (x, 0.06, -0.23), 0x101010, head)
    box("mouth", (0.22, 0.06, 0.02), (0, -0.12, -0.23), 0x1A3A2A, head)
    for i, side in enumerate((-1, 1)):
        arm = empty("arm_%d" % i, (side * 0.33, 1.18, -0.3), root)
        box("armmesh_%d" % i, (0.16, 0.62, 0.18), (0, -0.31, 0), 0x2F8F6A, arm)
    return "zombie"


def skeleton():
    root = new_model()
    leg(root, 0, (-0.12, 0.74, 0), (0.1, 0.74, 0.1), 0xD8D8D0)
    leg(root, 1, (0.12, 0.74, 0), (0.1, 0.74, 0.1), 0xD8D8D0)
    box("ribcage", (0.36, 0.66, 0.16), (0, 1.1, 0), 0xD8D8D0, root)
    box("shoulders", (0.44, 0.1, 0.12), (0, 1.32, 0), 0xC8C8C0, root)
    head = empty("head", (0, 1.62, 0), root)
    box("headmesh", (0.36, 0.36, 0.36), (0, 0, 0), 0xE4E4DC, head)
    for x in (-0.09, 0.09):
        box("eye_%s" % x, (0.09, 0.09, 0.02), (x, 0.04, -0.19), 0x1A1A1A, head)
    for i, side in enumerate((-1, 1)):
        arm = empty("arm_%d" % i, (side * 0.28, 1.12, 0), root)
        box("armmesh_%d" % i, (0.08, 0.62, 0.08), (0, -0.31, 0), 0xD8D8D0, arm)
    return "skeleton"


def spider():
    root = new_model()
    box("body", (0.8, 0.42, 0.7), (0, 0.6, 0.1), 0x2A2224, root)
    box("headmesh", (0.42, 0.34, 0.4), (0, 0.6, -0.42), 0x3A3034, root)
    for x in (-0.1, 0.1):
        box("eye_%s" % x, (0.08, 0.08, 0.04), (x, 0.67, -0.63), 0xD23A2E, root)
    index = 0
    for side in (-1, 1):
        for i in range(4):
            pivot = empty("leg_%d" % index,
                          (side * 0.34, 0.5, -0.3 + i * 0.22), root)
            segment = box("legmesh_%d" % index, (0.06, 0.06, 0.7),
                          (side * 0.22, -0.1, 0.14), 0x2A2224, pivot)
            segment.rotation_euler.z = side * (0.5 + i * 0.12)
            index += 1
    return "spider"


def creeper():
    root = new_model()
    for i, (x, z) in enumerate(((-0.14, 0), (0.14, 0), (-0.14, 0.36), (0.14, 0.36))):
        leg(root, i, (x, 0.4, z), (0.22, 0.4, 0.22), 0x3A8F3A)
    box("torso", (0.5, 0.85, 0.34), (0, 0.9, 0), 0x3A9F3A, root)
    head = empty("head", (0, 1.55, 0), root)
    box("headmesh", (0.46, 0.46, 0.46), (0, 0, 0), 0x45AA45, head)
    for x in (-0.1, 0.1):
        box("eye_%s" % x, (0.1, 0.1, 0.02), (x, 0.05, -0.24), 0x101010, head)
    box("mouth", (0.12, 0.2, 0.02), (0, -0.12, -0.24), 0x101010, head)
    return "creeper"


def enderman():
    root = new_model()
    leg(root, 0, (-0.13, 1.35, 0), (0.13, 1.35, 0.13), 0x14121A)
    leg(root, 1, (0.13, 1.35, 0), (0.13, 1.35, 0.13), 0x14121A)
    box("torso", (0.4, 0.8, 0.22), (0, 1.75, 0), 0x14121A, root)
    head = empty("head", (0, 2.35, 0), root)
    box("headmesh", (0.42, 0.42, 0.42), (0, 0, 0), 0x1A1722, head)
    box("eye", (0.28, 0.07, 0.02), (0, 0.06, -0.22), 0xB74AF0, head)
    for i, side in enumerate((-1, 1)):
        arm = empty("arm_%d" % i, (side * 0.3, 1.7, 0), root)
        box("armmesh_%d" % i, (0.1, 1.15, 0.1), (0, 0, 0), 0x14121A, arm)
    return "enderman"


def blaze():
    root = new_model()
    box("core", (0.42, 0.42, 0.42), (0, 1.1, 0), 0xF2C22E, root)
    box("core_hot", (0.24, 0.24, 0.24), (0, 1.42, 0), 0xFFE36A, root)
    for i in range(8):
        angle = (i / 8.0) * 3.141592653589793 * 2
        pivot = empty("rod_%d" % i, (0, 1.05, 0), root)
        rod = box("rodmesh_%d" % i, (0.1, 0.5, 0.1),
                  (math.cos(angle) * 0.34, 0, math.sin(angle) * 0.34),
                  0xF0A01C, pivot)
        rod.rotation_euler.y = -angle
    return "blaze"


# ---------------------------------------------------------------------------
# Player (third person + character creator)
# ---------------------------------------------------------------------------

def player():
    root = new_model()

    body = empty("body", (0, 1.08, 0), root)
    box("shirt_body", (0.54, 0.72, 0.3), (0, 0, 0), 0x3F8FD0, body)
    box("pants_belt", (0.56, 0.09, 0.32), (0, -0.28, 0), 0x2C2F36, body)
    box("accent_collar", (0.2, 0.07, 0.32), (0, 0.33, -0.01), 0x9FD0EC, body)

    head = empty("head", (0, 1.44, 0), root)
    box("skin_head", (0.48, 0.48, 0.48), (0, 0.23, 0), 0xD9A178, head)
    for x in (-0.115, 0.115):
        box("eye_white_%s" % x, (0.12, 0.11, 0.02), (x, 0.28, -0.25), 0xF5F1E6, head)
        box("eye_pupil_%s" % x, (0.055, 0.07, 0.025), (x + 0.01, 0.275, -0.265), 0x33435C, head)
        box("brow_%s" % x, (0.11, 0.025, 0.02), (x, 0.355, -0.255), 0x3A2A1E, head)
    box("skin_nose", (0.08, 0.1, 0.07), (0, 0.19, -0.26), 0xD9A178, head)
    box("mouth", (0.17, 0.035, 0.02), (0, 0.09, -0.25), 0x8D5245, head)

    for i, side in enumerate((-1, 1)):
        arm = empty(("leftArm" if i == 0 else "rightArm"), (side * 0.35, 1.4, 0), root)
        box("shirt_sleeve_%d" % i, (0.18, 0.28, 0.2), (0, -0.13, 0), 0x3F8FD0, arm)
        box("skin_hand_%d" % i, (0.16, 0.4, 0.18), (0, -0.46, 0), 0xD9A178, arm)

    for i, side in enumerate((-1, 1)):
        pivot = empty(("leftLeg" if i == 0 else "rightLeg"), (side * 0.13, 0.72, 0), root)
        box("pants_leg_%d" % i, (0.22, 0.72, 0.23), (0, -0.36, 0), 0x354789, pivot)
        box("shoe_%d" % i, (0.24, 0.14, 0.28), (0, -0.65, -0.02), 0x403223, pivot)
    return "player"


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

BUILDERS = [
    cow, pig, sheep, chicken, rabbit, horse, camel, wolf, fox, bee, bird,
    villager, iron_golem, zombie, skeleton, spider, creeper, enderman, blaze,
    player,
]

for build in BUILDERS:
    name = build()
    export(name)

print("DONE:", len(BUILDERS), "models in", OUT_DIR, flush=True)
