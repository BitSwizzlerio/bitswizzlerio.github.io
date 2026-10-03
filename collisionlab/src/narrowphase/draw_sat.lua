--[[
  Visualization of shapes, SAT axes, and 1D projection intervals.
]]

local draw = {}

local function setColor(c, a)
  love.graphics.setColor(c[1], c[2], c[3], a or c[4] or 1)
end

function draw.shape(shape, highlight, COLORS)
  local fill = highlight and { 0.2, 0.35, 0.5, 0.45 } or { 0.18, 0.22, 0.28, 0.55 }
  local edge = highlight and COLORS.accent or { 0.7, 0.75, 0.85, 1 }

  if shape.axisAligned and not shape:isCircle() then
    fill = highlight and { 0.25, 0.4, 0.28, 0.45 } or { 0.2, 0.28, 0.22, 0.55 }
  end
  if shape:isCircle() then
    fill = highlight and { 0.35, 0.28, 0.45, 0.45 } or { 0.28, 0.22, 0.32, 0.55 }
  end

  setColor(fill)
  if shape:isCircle() then
    love.graphics.circle("fill", shape.x, shape.y, shape.r)
    setColor(edge)
    love.graphics.setLineWidth(highlight and 2.5 or 1.5)
    love.graphics.circle("line", shape.x, shape.y, shape.r)
    -- radius tick
    setColor(COLORS.muted)
    love.graphics.line(shape.x, shape.y, shape.x + shape.r, shape.y)
  else
    local verts = shape:worldVertices()
    local flat = {}
    for _, v in ipairs(verts) do
      flat[#flat + 1] = v.x
      flat[#flat + 1] = v.y
    end
    love.graphics.polygon("fill", flat)
    setColor(edge)
    love.graphics.setLineWidth(highlight and 2.5 or 1.5)
    love.graphics.polygon("line", flat)

    if not shape.axisAligned then
      local len = 28
      local c, s = math.cos(shape.angle), math.sin(shape.angle)
      setColor(COLORS.muted)
      love.graphics.line(shape.x, shape.y, shape.x + c * len, shape.y + s * len)
    end
  end

  -- center + label
  setColor(COLORS.text)
  love.graphics.circle("fill", shape.x, shape.y, 3)
  local tag = shape.label
  if shape:isCircle() then
    tag = tag .. " [O]"
  elseif shape.axisAligned then
    tag = tag .. " [AABB]"
  end
  love.graphics.print(tag, shape.x + 6, shape.y - 18)

  love.graphics.setLineWidth(1.5)
end

function draw.selection(shape, COLORS)
  setColor(COLORS.accent, 0.9)
  love.graphics.setLineWidth(3)
  if shape:isCircle() then
    love.graphics.circle("line", shape.x, shape.y, shape.r + 2)
  else
    local verts = shape:worldVertices()
    local flat = {}
    for _, v in ipairs(verts) do
      flat[#flat + 1] = v.x
      flat[#flat + 1] = v.y
    end
    love.graphics.polygon("line", flat)
  end
  love.graphics.setLineWidth(1.5)
end

--- Clip infinite line P = M + t*D against the rectangle [x0,x1] x [y0,y1].
local function lineThroughRect(mx, my, nx, ny, x0, y0, x1, y1)
  local tMin, tMax = -math.huge, math.huge

  local function clip(p, d, minB, maxB)
    if math.abs(d) < 1e-12 then
      if p < minB or p > maxB then
        tMin = 1
        tMax = 0
      end
      return
    end
    local t1 = (minB - p) / d
    local t2 = (maxB - p) / d
    if t1 > t2 then t1, t2 = t2, t1 end
    if t1 > tMin then tMin = t1 end
    if t2 < tMax then tMax = t2 end
  end

  clip(mx, nx, x0, x1)
  clip(my, ny, y0, y1)
  if tMin > tMax then return nil end
  return mx + tMin * nx, my + tMin * ny, mx + tMax * nx, my + tMax * ny
end

--- Draw projection markers for a shape onto axis (nx, ny) through midpoint.
local function projectionMarkers(shape, nx, ny, mx, my, color)
  local mProj = mx * nx + my * ny

  local function mark(t, r)
    local qx = mx + (t - mProj) * nx
    local qy = my + (t - mProj) * ny
    setColor(color, 0.85)
    love.graphics.circle("fill", qx, qy, r or 3.5)
    return qx, qy
  end

  if shape:isCircle() then
    local c = shape.x * nx + shape.y * ny
    -- foot from center
    local qx, qy = mark(c, 4)
    setColor(color, 0.25)
    love.graphics.line(shape.x, shape.y, qx, qy)
    -- extent endpoints (+/- radius) along the axis
    mark(c - shape.r, 3)
    mark(c + shape.r, 3)
  else
    for _, v in ipairs(shape:worldVertices()) do
      local t = v.x * nx + v.y * ny
      local qx, qy = mark(t, 3.5)
      setColor(color, 0.25)
      love.graphics.line(v.x, v.y, qx, qy)
    end
  end
end

--- World-space part: MTV arrow, each SAT axis through the midpoint, and the projection markers.
--- Axis lines are clipped to the visible world region x0..x1, y0..y1.
function draw.axes(shapeA, shapeB, result, COLORS, x0, y0, x1, y1)
  local mx = (shapeA.x + shapeB.x) / 2
  local my = (shapeA.y + shapeB.y) / 2

  -- MTV arrow if colliding
  if result.colliding and result.mtv then
    setColor(COLORS.hit, 0.9)
    love.graphics.setLineWidth(3)
    local tx, ty = shapeA.x + result.mtv.x, shapeA.y + result.mtv.y
    love.graphics.line(shapeA.x, shapeA.y, tx, ty)
    local ang = math.atan2(result.mtv.y, result.mtv.x)
    local ah = 10
    love.graphics.polygon(
      "fill",
      tx, ty,
      tx - math.cos(ang - 0.4) * ah, ty - math.sin(ang - 0.4) * ah,
      tx - math.cos(ang + 0.4) * ah, ty - math.sin(ang + 0.4) * ah
    )
    love.graphics.setLineWidth(1.5)
    love.graphics.print("MTV", tx + 6, ty - 14)
  end

  for _, ax in ipairs(result.axes) do
    local nx, ny = ax.nx, ax.ny
    local col = ax.overlap and { COLORS.axis[1], COLORS.axis[2], COLORS.axis[3], 0.35 }
      or { COLORS.miss[1], COLORS.miss[2], COLORS.miss[3], 0.55 }
    love.graphics.setColor(col)
    love.graphics.setLineWidth(ax.overlap and 1 or 2.5)
    local lx1, ly1, lx2, ly2 = lineThroughRect(mx, my, nx, ny, x0, y0, x1, y1)
    if lx1 then
      love.graphics.line(lx1, ly1, lx2, ly2)
    end
    projectionMarkers(shapeA, nx, ny, mx, my, COLORS.projA)
    projectionMarkers(shapeB, nx, ny, mx, my, COLORS.projB)
  end
  love.graphics.setLineWidth(1.5)
end

--- Screen-space part: the 1D "projection rails", top-left of the world view `rect`.
--- Rails stop above maxY with a "+N axes" note (the side panel lists every axis).
function draw.rails(result, COLORS, rect, maxY)
  -- Sit below the world-pane header ("World space" + pair name at y~10/28)
  local railX = rect.x + 16
  local headerY = rect.y + 50
  local railY0 = rect.y + 78
  local barH = 10
  local gap = 28
  local railBgW = math.min(300, rect.w - 32)

  love.graphics.setColor(COLORS.text)
  love.graphics.print("Projection rails (active pair)", railX, headerY)

  local railMaxY = maxY
  local railsStopped = false

  for i, ax in ipairs(result.axes) do
    local nx, ny = ax.nx, ax.ny
    if not railsStopped then
      local y = railY0 + (i - 1) * gap
      if y + barH * 2 + 8 > railMaxY then
        setColor(COLORS.muted)
        love.graphics.print(
          string.format("... +%d axes (see side panel)", #result.axes - i + 1),
          railX, y - 4
        )
        railsStopped = true
      else
        -- Fit both intervals into the rail width (leave room for the normal arrow)
        local pad = 8
        local arrowRoom = 36
        local usable = railBgW - pad * 2 - arrowRoom
        local lo = math.min(ax.aMin, ax.bMin)
        local hi = math.max(ax.aMax, ax.bMax)
        local span = math.max(hi - lo, 1e-6)
        local function map(t)
          return pad + (t - lo) / span * usable
        end
        local a0, a1 = map(ax.aMin), map(ax.aMax)
        local b0, b1 = map(ax.bMin), map(ax.bMax)

        setColor(ax.overlap and COLORS.hit or COLORS.miss, 0.25)
        love.graphics.rectangle("fill", railX, y - 2, railBgW, barH * 2 + 8)

        setColor(COLORS.projA)
        love.graphics.rectangle("fill", railX + a0, y, math.max(2, a1 - a0), barH)
        setColor(COLORS.projB)
        love.graphics.rectangle("fill", railX + b0, y + barH + 2, math.max(2, b1 - b0), barH)

        setColor(COLORS.text)
        love.graphics.print(
          string.format("#%d %s  %s", i, ax.source or "", ax.overlap and "OK" or "GAP"),
          railX + 2, y - 14
        )

        setColor(COLORS.axis)
        local arrowX = railX + railBgW - arrowRoom + 8
        love.graphics.line(arrowX, y + barH, arrowX + nx * 18, y + barH + ny * 18)
      end
    end
  end

  love.graphics.setLineWidth(1.5)
end

return draw
