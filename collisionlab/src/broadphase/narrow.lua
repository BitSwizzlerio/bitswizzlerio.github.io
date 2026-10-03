--[[
  Cheap narrowphase tests used after broadphase candidates are found.
  Supports AABB-AABB, AABB-circle, and circle-circle.
]]

local narrow = {}

local function aabbAabb(a, b)
  return a.maxX >= b.minX
    and a.minX <= b.maxX
    and a.maxY >= b.minY
    and a.minY <= b.maxY
end

local function circleCircle(ax, ay, ar, bx, by, br)
  local dx, dy = bx - ax, by - ay
  local r = ar + br
  return dx * dx + dy * dy <= r * r
end

--- Closest point on AABB to a point (for AABB-circle).
local function closestOnAabb(aabb, px, py)
  local cx = math.max(aabb.minX, math.min(px, aabb.maxX))
  local cy = math.max(aabb.minY, math.min(py, aabb.maxY))
  return cx, cy
end

local function aabbCircle(aabb, cx, cy, r)
  local qx, qy = closestOnAabb(aabb, cx, cy)
  local dx, dy = cx - qx, cy - qy
  return dx * dx + dy * dy <= r * r
end

--- Test two bodies. Returns colliding bool and a short method label.
function narrow.test(bodyA, bodyB)
  local aIsC = bodyA:isCircle()
  local bIsC = bodyB:isCircle()

  if aIsC and bIsC then
    local hit = circleCircle(bodyA.x, bodyA.y, bodyA.r, bodyB.x, bodyB.y, bodyB.r)
    return hit, "circle-circle"
  end

  if not aIsC and not bIsC then
    local hit = aabbAabb(bodyA:aabb(), bodyB:aabb())
    return hit, "AABB-AABB"
  end

  -- Mixed: AABB vs circle
  local box, circle
  if aIsC then
    circle, box = bodyA, bodyB
  else
    box, circle = bodyA, bodyB
  end
  local hit = aabbCircle(box:aabb(), circle.x, circle.y, circle.r)
  return hit, "AABB-circle"
end

--- Axis-aligned bounds overlap only (proxy test; not the true circle test).
function narrow.aabbProxyOverlap(bodyA, bodyB)
  return aabbAabb(bodyA:aabb(), bodyB:aabb())
end

return narrow
