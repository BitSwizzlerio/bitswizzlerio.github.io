--[[
  Shared drawing: shapes in world space, panels, text helpers.
]]

local draw = {}

local function setColor(c, a)
  love.graphics.setColor(c[1], c[2], c[3], a or c[4] or 1)
end

function draw.setColor(c, a)
  setColor(c, a)
end

function draw.shape(shape, COLORS, opts)
  opts = opts or {}
  local highlight = opts.highlight
  local fillA = opts.isA
  local fill = fillA
      and (highlight and { 0.25, 0.45, 0.75, 0.50 } or { 0.20, 0.35, 0.55, 0.45 })
      or (highlight and { 0.85, 0.50, 0.25, 0.50 } or { 0.60, 0.38, 0.18, 0.45 })
  local edge = fillA and COLORS.projA or COLORS.projB
  if highlight then
    edge = COLORS.accent
  end

  setColor(fill)
  if shape:isCircle() then
    love.graphics.circle("fill", shape.x, shape.y, shape.r)
    setColor(edge)
    love.graphics.setLineWidth(highlight and 2.5 or 1.5)
    love.graphics.circle("line", shape.x, shape.y, shape.r)
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

    local len = 26
    local c, s = math.cos(shape.angle), math.sin(shape.angle)
    setColor(COLORS.muted)
    love.graphics.line(shape.x, shape.y, shape.x + c * len, shape.y + s * len)
  end

  setColor(COLORS.text)
  love.graphics.circle("fill", shape.x, shape.y, 3)
  love.graphics.print(shape.label, shape.x + 6, shape.y - 18)
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

--- Draw support witnesses on A and B for a Minkowski support point.
function draw.supportWitnesses(supp, COLORS)
  if not supp or not supp.ax then return end
  setColor(COLORS.projA, 0.9)
  love.graphics.circle("fill", supp.ax, supp.ay, 5)
  setColor(COLORS.projB, 0.9)
  love.graphics.circle("fill", supp.bx, supp.by, 5)
  setColor(COLORS.muted, 0.5)
  love.graphics.setLineWidth(1)
  love.graphics.line(supp.ax, supp.ay, supp.bx, supp.by)
  love.graphics.setLineWidth(1.5)
end

function draw.panel(x, y, w, h, COLORS)
  setColor(COLORS.panel)
  love.graphics.rectangle("fill", x, y, w, h)
  setColor(COLORS.muted, 0.4)
  love.graphics.rectangle("line", x, y, w, h)
end

function draw.arrow(x1, y1, x2, y2, color, width)
  setColor(color)
  love.graphics.setLineWidth(width or 2)
  love.graphics.line(x1, y1, x2, y2)
  local ang = math.atan2(y2 - y1, x2 - x1)
  local ah = 10
  love.graphics.polygon(
    "fill",
    x2, y2,
    x2 - math.cos(ang - 0.4) * ah, y2 - math.sin(ang - 0.4) * ah,
    x2 - math.cos(ang + 0.4) * ah, y2 - math.sin(ang + 0.4) * ah
  )
  love.graphics.setLineWidth(1.5)
end

function draw.crosshair(x, y, size, color)
  setColor(color)
  love.graphics.setLineWidth(1.5)
  love.graphics.line(x - size, y, x + size, y)
  love.graphics.line(x, y - size, x, y + size)
  love.graphics.circle("line", x, y, 4)
end

--- Clip drawing to a rectangle (scissor).
function draw.withScissor(x, y, w, h, fn)
  local sx, sy, sw, sh = love.graphics.getScissor()
  love.graphics.setScissor(x, y, w, h)
  fn()
  if sx then
    love.graphics.setScissor(sx, sy, sw, sh)
  else
    love.graphics.setScissor()
  end
end

return draw
