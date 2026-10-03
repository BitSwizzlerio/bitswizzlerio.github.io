--[[
  Sample the Minkowski difference C = A - B via the support map.
  For any convex pair, angular support samples outline C (educational viz).
]]

local support = require("narrowphase.support")

local minkowski = {}

--- Sample boundary of C by evaluating support in evenly spaced directions.
function minkowski.sample(shapeA, shapeB, n)
  n = n or 64
  local pts = {}
  for i = 0, n - 1 do
    local a = i * (2 * math.pi / n)
    local dx, dy = math.cos(a), math.sin(a)
    local p = support.diffPoint(shapeA, shapeB, dx, dy)
    pts[#pts + 1] = { x = p.x, y = p.y }
  end
  return pts
end

--- Approximate bounds of C (for camera fit).
function minkowski.bounds(pts)
  if #pts == 0 then
    return -1, -1, 1, 1
  end
  local minX, minY = pts[1].x, pts[1].y
  local maxX, maxY = minX, minY
  for i = 2, #pts do
    local p = pts[i]
    if p.x < minX then minX = p.x end
    if p.y < minY then minY = p.y end
    if p.x > maxX then maxX = p.x end
    if p.y > maxY then maxY = p.y end
  end
  -- Always include the origin in the view
  if 0 < minX then minX = 0 end
  if 0 > maxX then maxX = 0 end
  if 0 < minY then minY = 0 end
  if 0 > maxY then maxY = 0 end
  return minX, minY, maxX, maxY
end

--- Map a point in Minkowski space into a screen rect (with padding).
function minkowski.camera(pts, rectX, rectY, rectW, rectH, pad)
  pad = pad or 28
  local minX, minY, maxX, maxY = minkowski.bounds(pts)
  local bw = math.max(maxX - minX, 1e-3)
  local bh = math.max(maxY - minY, 1e-3)
  local availW = rectW - pad * 2
  local availH = rectH - pad * 2
  local scale = math.min(availW / bw, availH / bh)
  local cx = (minX + maxX) / 2
  local cy = (minY + maxY) / 2
  local ox = rectX + rectW / 2 - cx * scale
  local oy = rectY + rectH / 2 - cy * scale

  local function toScreen(x, y)
    return ox + x * scale, oy + y * scale
  end

  local function toWorld(sx, sy)
    return (sx - ox) / scale, (sy - oy) / scale
  end

  return {
    scale = scale,
    ox = ox,
    oy = oy,
    toScreen = toScreen,
    toWorld = toWorld,
    minX = minX, minY = minY, maxX = maxX, maxY = maxY,
  }
end

return minkowski
