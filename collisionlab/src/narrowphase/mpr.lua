--[[
  2D Minkowski Portal Refinement (MPR / XenoCollide-style) with step recording.

  Uses an interior point v0 of C = A - B and refines a portal (edge in 2D)
  until the ray v0 -> origin is classified as hit or miss.

  On hit, reports an approximate contact normal (portal outward normal)
  and penetration depth estimate along that normal.

  Note strings are ASCII-only so Love's default font can render them.
]]

local support = require("narrowphase.support")

local mpr = {}

local MAX_ITERS = 32
local EPS = 1e-7
local DEPTH_EPS = 1e-5

local function vcopy(p)
  return {
    x = p.x, y = p.y,
    ax = p.ax, ay = p.ay,
    bx = p.bx, by = p.by,
  }
end

local function pt(x, y, ax, ay, bx, by)
  return { x = x, y = y, ax = ax, ay = ay, bx = bx, by = by }
end

local function cross(ax, ay, bx, by)
  return ax * by - ay * bx
end

local function dot(ax, ay, bx, by)
  return ax * bx + ay * by
end

local function len(x, y)
  return math.sqrt(x * x + y * y)
end

--- Outward normal of portal edge v1->v2 (pointing away from interior v0).
local function portalNormal(v0, v1, v2)
  local ex, ey = v2.x - v1.x, v2.y - v1.y
  local n1x, n1y = -ey, ex
  local mx = (v1.x + v2.x) * 0.5
  local my = (v1.y + v2.y) * 0.5
  local awayx, awayy = mx - v0.x, my - v0.y
  if n1x * awayx + n1y * awayy < 0 then
    n1x, n1y = -n1x, -n1y
  end
  local l = len(n1x, n1y)
  if l < EPS then
    return 1, 0
  end
  return n1x / l, n1y / l
end

--- Origin is behind portal plane (through v1, outward normal n) if n.v1 >= 0.
local function originBehindPortal(v1, nx, ny)
  return nx * v1.x + ny * v1.y >= -DEPTH_EPS
end

function mpr.test(shapeA, shapeB)
  local steps = {}

  -- Interior point of C (valid when each shape contains its center)
  local v0 = pt(shapeA.x - shapeB.x, shapeA.y - shapeB.y)

  steps[#steps + 1] = {
    phase = "v0",
    v0 = vcopy(v0),
    portal = nil,
    support = nil,
    normal = nil,
    colliding = nil,
    note = "Interior point v0 = cA - cB (must lie inside C)",
  }

  local v0len = len(v0.x, v0.y)
  if v0len < EPS then
    steps[#steps + 1] = {
      phase = "done",
      v0 = vcopy(v0),
      portal = nil,
      support = nil,
      normal = { x = 1, y = 0 },
      colliding = true,
      depth = 0,
      note = "Centers coincide (v0 ~ origin) -> treat as colliding",
    }
    return {
      colliding = true,
      steps = steps,
      iterations = 0,
      normal = { x = 1, y = 0 },
      depth = 0,
    }
  end

  ------------------------------------------------------------------
  -- Phase 1: discover initial portal
  ------------------------------------------------------------------
  local d1x, d1y = -v0.x, -v0.y
  local v1 = support.diffPoint(shapeA, shapeB, d1x, d1y)

  steps[#steps + 1] = {
    phase = "discover",
    v0 = vcopy(v0),
    portal = { vcopy(v1) },
    support = vcopy(v1),
    normal = { x = d1x / v0len, y = d1y / v0len },
    dir = { x = d1x, y = d1y },
    colliding = nil,
    note = "v1 = support(C, origin - v0)",
  }

  if dot(v1.x, v1.y, d1x, d1y) < 0 then
    steps[#steps + 1] = {
      phase = "done",
      v0 = vcopy(v0),
      portal = { vcopy(v1) },
      support = vcopy(v1),
      normal = { x = d1x / v0len, y = d1y / v0len },
      colliding = false,
      note = "v1 does not pass origin along v0->O -> SEPARATED",
    }
    return { colliding = false, steps = steps, iterations = 0 }
  end

  -- Direction for v2: perpendicular to (v1 - v0), toward the origin side
  local e1x, e1y = v1.x - v0.x, v1.y - v0.y
  local n2x, n2y = -e1y, e1x
  if cross(e1x, e1y, -v0.x, -v0.y) < 0 then
    n2x, n2y = e1y, -e1x
  end
  if len(n2x, n2y) < EPS then
    n2x, n2y = 1, 0
  end

  local v2 = support.diffPoint(shapeA, shapeB, n2x, n2y)

  steps[#steps + 1] = {
    phase = "discover",
    v0 = vcopy(v0),
    portal = { vcopy(v1), vcopy(v2) },
    support = vcopy(v2),
    normal = { x = n2x, y = n2y },
    dir = { x = n2x, y = n2y },
    colliding = nil,
    note = "v2 = support to form initial portal edge (v1, v2)",
  }

  local function originBetween()
    local c1 = cross(v1.x - v0.x, v1.y - v0.y, -v0.x, -v0.y)
    local c2 = cross(v2.x - v0.x, v2.y - v0.y, -v0.x, -v0.y)
    return c1 * c2 <= 0
  end

  if not originBetween() then
    n2x, n2y = -n2x, -n2y
    v2 = support.diffPoint(shapeA, shapeB, n2x, n2y)
    steps[#steps + 1] = {
      phase = "discover",
      v0 = vcopy(v0),
      portal = { vcopy(v1), vcopy(v2) },
      support = vcopy(v2),
      normal = { x = n2x, y = n2y },
      dir = { x = n2x, y = n2y },
      colliding = nil,
      note = "Reoriented portal so ray v0->O lies between v0v1 and v0v2",
    }
  end

  -- Degenerate start: if the ray still misses the wedge, push v1 toward O again
  if not originBetween() then
    v1 = support.diffPoint(shapeA, shapeB, d1x, d1y)
    steps[#steps + 1] = {
      phase = "discover",
      v0 = vcopy(v0),
      portal = { vcopy(v1), vcopy(v2) },
      support = vcopy(v1),
      normal = { x = d1x / v0len, y = d1y / v0len },
      dir = { x = d1x, y = d1y },
      colliding = nil,
      note = "Refreshed v1 after portal wedge missed ray v0->O",
    }
  end

  ------------------------------------------------------------------
  -- Phase 2: refine portal
  ------------------------------------------------------------------
  for iter = 1, MAX_ITERS do
    local nx, ny = portalNormal(v0, v1, v2)

    steps[#steps + 1] = {
      phase = "refine",
      iter = iter,
      v0 = vcopy(v0),
      portal = { vcopy(v1), vcopy(v2) },
      support = nil,
      normal = { x = nx, y = ny },
      colliding = nil,
      note = string.format(
        "Portal normal n=(%.3f, %.3f); plane offset n.v1=%.4f",
        nx, ny, nx * v1.x + ny * v1.y
      ),
    }

    if originBehindPortal(v1, nx, ny) then
      local sHit = support.diffPoint(shapeA, shapeB, nx, ny)
      local depth = math.max(0, nx * sHit.x + ny * sHit.y)

      steps[#steps + 1] = {
        phase = "done",
        iter = iter,
        v0 = vcopy(v0),
        portal = { vcopy(v1), vcopy(v2) },
        support = vcopy(sHit),
        normal = { x = nx, y = ny },
        colliding = true,
        depth = depth,
        note = string.format(
          "Origin behind portal -> COLLIDING  depth~%.3f  n=(%.2f,%.2f)",
          depth, nx, ny
        ),
      }
      return {
        colliding = true,
        steps = steps,
        iterations = iter,
        normal = { x = nx, y = ny },
        depth = depth,
      }
    end

    local v = support.diffPoint(shapeA, shapeB, nx, ny)

    steps[#steps + 1] = {
      phase = "support",
      iter = iter,
      v0 = vcopy(v0),
      portal = { vcopy(v1), vcopy(v2) },
      support = vcopy(v),
      normal = { x = nx, y = ny },
      dir = { x = nx, y = ny },
      colliding = nil,
      note = string.format(
        "v = support(C, n);  n.v=%.4f  n.v1=%.4f",
        nx * v.x + ny * v.y, nx * v1.x + ny * v1.y
      ),
    }

    if nx * v.x + ny * v.y < 0 then
      steps[#steps + 1] = {
        phase = "done",
        iter = iter,
        v0 = vcopy(v0),
        portal = { vcopy(v1), vcopy(v2) },
        support = vcopy(v),
        normal = { x = nx, y = ny },
        colliding = false,
        note = "Support fails to pass origin along portal normal -> SEPARATED",
      }
      return {
        colliding = false,
        steps = steps,
        iterations = iter,
        normal = { x = nx, y = ny },
      }
    end

    local expand = nx * (v.x - v1.x) + ny * (v.y - v1.y)
    if expand < DEPTH_EPS then
      local depth = math.max(0, nx * v.x + ny * v.y)
      steps[#steps + 1] = {
        phase = "done",
        iter = iter,
        v0 = vcopy(v0),
        portal = { vcopy(v1), vcopy(v2) },
        support = vcopy(v),
        normal = { x = nx, y = ny },
        colliding = true,
        depth = depth,
        note = string.format(
          "Portal refined (delta < eps) -> COLLIDING  depth~%.3f",
          depth
        ),
      }
      return {
        colliding = true,
        steps = steps,
        iterations = iter,
        normal = { x = nx, y = ny },
        depth = depth,
      }
    end

    -- Keep the half-plane of the portal that still contains the origin ray.
    local cv = cross(v.x - v0.x, v.y - v0.y, -v0.x, -v0.y)
    local c1 = cross(v1.x - v0.x, v1.y - v0.y, -v0.x, -v0.y)

    if cv * c1 > 0 then
      v1 = v
      steps[#steps + 1] = {
        phase = "replace",
        iter = iter,
        v0 = vcopy(v0),
        portal = { vcopy(v1), vcopy(v2) },
        support = vcopy(v),
        normal = { x = nx, y = ny },
        colliding = nil,
        note = "Replace v1 with new support (ray on v2 side)",
      }
    else
      v2 = v
      steps[#steps + 1] = {
        phase = "replace",
        iter = iter,
        v0 = vcopy(v0),
        portal = { vcopy(v1), vcopy(v2) },
        support = vcopy(v),
        normal = { x = nx, y = ny },
        colliding = nil,
        note = "Replace v2 with new support (ray on v1 side)",
      }
    end
  end

  steps[#steps + 1] = {
    phase = "done",
    v0 = vcopy(v0),
    portal = { vcopy(v1), vcopy(v2) },
    support = nil,
    normal = nil,
    colliding = false,
    note = "Hit iteration limit",
  }
  return { colliding = false, steps = steps, iterations = MAX_ITERS }
end

return mpr
