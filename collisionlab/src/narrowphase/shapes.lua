--[[
  Convex shape helpers for NarrowphaseCollisionLab.
  Local vertices are relative to center; angle is rotation in radians.
  axisAligned = true forces angle = 0 (AABB mode for SAT).
  Circles use kind = "circle" and radius r.
]]

local shapes = {}

local Shape = {}
Shape.__index = Shape

function Shape:isCircle()
  return self.kind == "circle"
end

function Shape:worldVertices()
  if self:isCircle() then
    return {}
  end
  local angle = self.axisAligned and 0 or self.angle
  local c, s = math.cos(angle), math.sin(angle)
  local out = {}
  for i, v in ipairs(self.localVerts) do
    out[i] = {
      x = self.x + v.x * c - v.y * s,
      y = self.y + v.x * s + v.y * c,
    }
  end
  return out
end

function Shape:radius()
  if self:isCircle() then
    return self.r
  end
  local r = 0
  for _, v in ipairs(self.localVerts) do
    local d = math.sqrt(v.x * v.x + v.y * v.y)
    if d > r then r = d end
  end
  return r
end

local function newShape(x, y, localVerts, angle, axisAligned, label)
  return setmetatable({
    kind = "polygon",
    x = x,
    y = y,
    angle = angle or 0,
    axisAligned = axisAligned or false,
    localVerts = localVerts,
    label = label or "?",
  }, Shape)
end

--- Axis-aligned or oriented rectangle (full width/height)
function shapes.rect(x, y, w, h, angle, axisAligned, label)
  local hw, hh = w / 2, h / 2
  return newShape(x, y, {
    { x = -hw, y = -hh },
    { x =  hw, y = -hh },
    { x =  hw, y =  hh },
    { x = -hw, y =  hh },
  }, angle, axisAligned, label)
end

--- Regular n-gon
function shapes.regular(x, y, n, radius, angle, label)
  local verts = {}
  for i = 0, n - 1 do
    local a = -math.pi / 2 + i * (2 * math.pi / n)
    verts[#verts + 1] = { x = math.cos(a) * radius, y = math.sin(a) * radius }
  end
  return newShape(x, y, verts, angle, false, label)
end

--- Arbitrary local polygon (must be convex)
function shapes.polygon(x, y, points, angle, label)
  local verts = {}
  for i, p in ipairs(points) do
    verts[i] = { x = p[1] or p.x, y = p[2] or p.y }
  end
  return newShape(x, y, verts, angle, false, label)
end

--- Circle (rotation-invariant)
function shapes.circle(x, y, r, label)
  return setmetatable({
    kind = "circle",
    x = x,
    y = y,
    r = r,
    angle = 0,
    axisAligned = true,
    localVerts = {},
    label = label or "?",
  }, Shape)
end

local function pointInPoly(verts, px, py)
  local n = #verts
  for _, wantPositive in ipairs({ true, false }) do
    local inside = true
    for i = 1, n do
      local a = verts[i]
      local b = verts[i % n + 1]
      local cross = (b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x)
      if wantPositive then
        if cross < 0 then inside = false; break end
      else
        if cross > 0 then inside = false; break end
      end
    end
    if inside then return true end
  end
  return false
end

function shapes.pointIn(shape, px, py)
  if shape:isCircle() then
    local dx, dy = px - shape.x, py - shape.y
    return dx * dx + dy * dy <= shape.r * shape.r
  end
  return pointInPoly(shape:worldVertices(), px, py)
end

return shapes
