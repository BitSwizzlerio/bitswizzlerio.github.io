--[[
  Simple 2D bodies for BroadphaseCollisionLab.
  Kinds: "aabb" (axis-aligned box) and "circle".
  Every body exposes an AABB proxy used by the spatial hash.
]]

local shapes = {}

local Body = {}
Body.__index = Body

function Body:isCircle()
  return self.kind == "circle"
end

function Body:isAabb()
  return self.kind == "aabb"
end

--- World-space AABB proxy { minX, minY, maxX, maxY }
function Body:aabb()
  if self:isCircle() then
    return {
      minX = self.x - self.r,
      minY = self.y - self.r,
      maxX = self.x + self.r,
      maxY = self.y + self.r,
    }
  end
  local hw, hh = self.w * 0.5, self.h * 0.5
  return {
    minX = self.x - hw,
    minY = self.y - hh,
    maxX = self.x + hw,
    maxY = self.y + hh,
  }
end

function Body:radius()
  if self:isCircle() then
    return self.r
  end
  return 0.5 * math.sqrt(self.w * self.w + self.h * self.h)
end

function shapes.aabb(x, y, w, h, label)
  return setmetatable({
    kind = "aabb",
    x = x,
    y = y,
    w = w,
    h = h,
    vx = 0,
    vy = 0,
    label = label or "",
    id = 0,
  }, Body)
end

function shapes.circle(x, y, r, label)
  return setmetatable({
    kind = "circle",
    x = x,
    y = y,
    r = r,
    vx = 0,
    vy = 0,
    label = label or "",
    id = 0,
  }, Body)
end

function shapes.pointIn(body, px, py)
  if body:isCircle() then
    local dx, dy = px - body.x, py - body.y
    return dx * dx + dy * dy <= body.r * body.r
  end
  local a = body:aabb()
  return px >= a.minX and px <= a.maxX and py >= a.minY and py <= a.maxY
end

--- Clamp body center so its AABB stays inside the playfield margins.
function shapes.clampToBounds(body, bounds, margin)
  margin = margin or 0
  local a = body:aabb()
  local halfW = (a.maxX - a.minX) * 0.5
  local halfH = (a.maxY - a.minY) * 0.5
  local minX = bounds.x + margin + halfW
  local maxX = bounds.x + bounds.w - margin - halfW
  local minY = bounds.y + margin + halfH
  local maxY = bounds.y + bounds.h - margin - halfH
  if minX > maxX then
    body.x = bounds.x + bounds.w * 0.5
  else
    body.x = math.max(minX, math.min(maxX, body.x))
  end
  if minY > maxY then
    body.y = bounds.y + bounds.h * 0.5
  else
    body.y = math.max(minY, math.min(maxY, body.y))
  end
end

return shapes
