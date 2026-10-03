--[[
  Support maps for convex shapes and the Minkowski difference C = A - B.
  support(C, d) = support(A, d) - support(B, -d)
]]

local support = {}

local function len(x, y)
  return math.sqrt(x * x + y * y)
end

--- Support point of a single shape in direction (dx, dy).
function support.point(shape, dx, dy)
  if shape:isCircle() then
    local l = len(dx, dy)
    if l < 1e-12 then
      return shape.x, shape.y
    end
    return shape.x + dx / l * shape.r, shape.y + dy / l * shape.r
  end

  local verts = shape:worldVertices()
  local best = verts[1]
  local bestDot = best.x * dx + best.y * dy
  for i = 2, #verts do
    local v = verts[i]
    local d = v.x * dx + v.y * dy
    if d > bestDot then
      bestDot = d
      best = v
    end
  end
  return best.x, best.y
end

--- Support of Minkowski difference A - B in direction d.
function support.diff(shapeA, shapeB, dx, dy)
  local ax, ay = support.point(shapeA, dx, dy)
  local bx, by = support.point(shapeB, -dx, -dy)
  return ax - bx, ay - by, ax, ay, bx, by
end

--- Return support as a table {x,y} plus optional witness points on A and B.
function support.diffPoint(shapeA, shapeB, dx, dy)
  local cx, cy, ax, ay, bx, by = support.diff(shapeA, shapeB, dx, dy)
  return {
    x = cx, y = cy,
    ax = ax, ay = ay,
    bx = bx, by = by,
  }
end

function support.normalize(dx, dy)
  local l = len(dx, dy)
  if l < 1e-12 then
    return 1, 0, 0
  end
  return dx / l, dy / l, l
end

function support.dot(ax, ay, bx, by)
  return ax * bx + ay * by
end

function support.cross(ax, ay, bx, by)
  return ax * by - ay * bx
end

function support.len(x, y)
  return len(x, y)
end

return support
