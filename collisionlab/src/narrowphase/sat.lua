--[[
  Separating Axis Theorem for convex polygons and circles.
  Returns per-axis projection intervals, overlap amounts, MTV, and separating axis.
]]

local sat = {}

local function projectVerts(verts, nx, ny)
  local minp = verts[1].x * nx + verts[1].y * ny
  local maxp = minp
  for i = 2, #verts do
    local p = verts[i].x * nx + verts[i].y * ny
    if p < minp then minp = p end
    if p > maxp then maxp = p end
  end
  return minp, maxp
end

local function projectCircle(cx, cy, r, nx, ny)
  local c = cx * nx + cy * ny
  return c - r, c + r
end

local function projectShape(shape, nx, ny)
  if shape:isCircle() then
    return projectCircle(shape.x, shape.y, shape.r, nx, ny)
  end
  return projectVerts(shape:worldVertices(), nx, ny)
end

local function edgeNormals(verts)
  local axes = {}
  local n = #verts
  for i = 1, n do
    local a = verts[i]
    local b = verts[i % n + 1]
    local ex = b.x - a.x
    local ey = b.y - a.y
    local nx, ny = -ey, ex
    local len = math.sqrt(nx * nx + ny * ny)
    if len > 1e-8 then
      nx, ny = nx / len, ny / len
      local dup = false
      for _, ax in ipairs(axes) do
        if math.abs(ax.nx * nx + ax.ny * ny) > 0.999 then
          dup = true
          break
        end
      end
      if not dup then
        table.insert(axes, { nx = nx, ny = ny })
      end
    end
  end
  return axes
end

local function clamp(v, lo, hi)
  if v < lo then return lo end
  if v > hi then return hi end
  return v
end

--- Closest point on convex polygon to (px, py).
local function closestPointOnPoly(px, py, verts)
  local n = #verts
  local bestX, bestY, bestD2 = verts[1].x, verts[1].y, math.huge
  local inside = true
  local sign = nil

  for i = 1, n do
    local a = verts[i]
    local b = verts[i % n + 1]
    local abx, aby = b.x - a.x, b.y - a.y
    local apx, apy = px - a.x, py - a.y
    local cross = abx * apy - aby * apx
    if sign == nil then
      sign = cross >= 0
    elseif (cross >= 0) ~= sign then
      inside = false
    end

    local ab2 = abx * abx + aby * aby
    local t = 0
    if ab2 > 1e-12 then
      t = clamp((apx * abx + apy * aby) / ab2, 0, 1)
    end
    local qx = a.x + abx * t
    local qy = a.y + aby * t
    local dx, dy = px - qx, py - qy
    local d2 = dx * dx + dy * dy
    if d2 < bestD2 then
      bestD2 = d2
      bestX, bestY = qx, qy
    end
  end

  if inside then
    return px, py, true
  end
  return bestX, bestY, false
end

local function addAxis(axes, nx, ny, source)
  local len = math.sqrt(nx * nx + ny * ny)
  if len < 1e-8 then return end
  nx, ny = nx / len, ny / len
  for _, ax in ipairs(axes) do
    if math.abs(ax.nx * nx + ax.ny * ny) > 0.999 then
      return
    end
  end
  table.insert(axes, { nx = nx, ny = ny, source = source })
end

local function evaluateAxes(shapeA, shapeB, axes)
  local colliding = true
  local minOverlap = math.huge
  local mtvX, mtvY = 0, 0
  local sepAxis = { x = 0, y = 0 }
  local detailed = {}

  for _, ax in ipairs(axes) do
    local aMin, aMax = projectShape(shapeA, ax.nx, ax.ny)
    local bMin, bMax = projectShape(shapeB, ax.nx, ax.ny)

    local overlapAmount
    local overlap = false
    if aMax < bMin or bMax < aMin then
      if aMax < bMin then
        overlapAmount = aMax - bMin
      else
        overlapAmount = bMax - aMin
      end
      colliding = false
      if not sepAxis.set then
        sepAxis = { x = ax.nx, y = ax.ny, set = true }
      end
    else
      overlap = true
      local o1 = aMax - bMin
      local o2 = bMax - aMin
      overlapAmount = math.min(o1, o2)
      if overlapAmount < minOverlap then
        minOverlap = overlapAmount
        local dx = shapeA.x - shapeB.x
        local dy = shapeA.y - shapeB.y
        if dx * ax.nx + dy * ax.ny < 0 then
          mtvX, mtvY = -ax.nx * overlapAmount, -ax.ny * overlapAmount
        else
          mtvX, mtvY = ax.nx * overlapAmount, ax.ny * overlapAmount
        end
      end
    end

    table.insert(detailed, {
      nx = ax.nx,
      ny = ax.ny,
      source = ax.source,
      aMin = aMin,
      aMax = aMax,
      bMin = bMin,
      bMax = bMax,
      overlap = overlap,
      overlapAmount = overlapAmount,
    })
  end

  local result = {
    colliding = colliding,
    axes = detailed,
    sepAxis = { x = sepAxis.x, y = sepAxis.y },
  }

  if colliding then
    -- No usable axes (degenerate geometry): treat as non-colliding rather than depth=inf
    if minOverlap == math.huge or #detailed == 0 then
      result.colliding = false
      result.depth = 0
      result.mtv = nil
    else
      result.depth = minOverlap
      result.mtv = { x = mtvX, y = mtvY }
    end
  else
    result.depth = 0
    result.mtv = nil
  end

  return result
end

local function testCircleCircle(a, b)
  local dx = b.x - a.x
  local dy = b.y - a.y
  local dist2 = dx * dx + dy * dy
  local dist = math.sqrt(dist2)
  local nx, ny = 1, 0
  if dist > 1e-8 then
    nx, ny = dx / dist, dy / dist
  end

  local axes = { { nx = nx, ny = ny, source = "C" } }
  return evaluateAxes(a, b, axes)
end

local function testCirclePoly(circle, poly, circleIsA)
  local shapeA = circleIsA and circle or poly
  local shapeB = circleIsA and poly or circle

  local verts = poly:worldVertices()
  local axes = {}

  for _, ax in ipairs(edgeNormals(verts)) do
    addAxis(axes, ax.nx, ax.ny, circleIsA and "B" or "A")
  end

  -- Axis from circle center to closest point on the polygon (critical for corners)
  local qx, qy, inside = closestPointOnPoly(circle.x, circle.y, verts)
  if inside then
    -- Center inside poly: use nearest edge normal (already covered); add a fallback axis
    if #axes == 0 then
      addAxis(axes, 1, 0, "C")
    end
  else
    addAxis(axes, circle.x - qx, circle.y - qy, "C")
  end

  return evaluateAxes(shapeA, shapeB, axes)
end

local function testPolyPoly(shapeA, shapeB)
  local va = shapeA:worldVertices()
  local vb = shapeB:worldVertices()
  local axes = {}
  for _, ax in ipairs(edgeNormals(va)) do
    addAxis(axes, ax.nx, ax.ny, "A")
  end
  for _, ax in ipairs(edgeNormals(vb)) do
    addAxis(axes, ax.nx, ax.ny, "B")
  end
  return evaluateAxes(shapeA, shapeB, axes)
end

--- Full collision test between two shapes (polygon and/or circle).
function sat.test(shapeA, shapeB)
  local aCirc = shapeA:isCircle()
  local bCirc = shapeB:isCircle()

  if aCirc and bCirc then
    return testCircleCircle(shapeA, shapeB)
  elseif aCirc then
    return testCirclePoly(shapeA, shapeB, true)
  elseif bCirc then
    return testCirclePoly(shapeB, shapeA, false)
  else
    return testPolyPoly(shapeA, shapeB)
  end
end

function sat.worldVerts(shape)
  return shape:worldVertices()
end

return sat
