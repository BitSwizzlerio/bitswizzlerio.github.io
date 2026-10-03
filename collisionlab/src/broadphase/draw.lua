--[[
  Drawing helpers for BroadphaseCollisionLab.
]]

local draw = {}

local function setColor(c, a)
  love.graphics.setColor(c[1], c[2], c[3], a or c[4] or 1)
end

function draw.setColor(c, a)
  setColor(c, a)
end

function draw.panel(x, y, w, h, COLORS)
  setColor(COLORS.panel)
  love.graphics.rectangle("fill", x, y, w, h)
  setColor(COLORS.muted, 0.4)
  love.graphics.rectangle("line", x, y, w, h)
end

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

--- Full grid lines over the playfield (clipped by scissor outside).
function draw.gridLines(bounds, cellSize, COLORS)
  setColor(COLORS.gridLine, 0.35)
  love.graphics.setLineWidth(1)
  local x0 = math.floor(bounds.x / cellSize) * cellSize
  local y0 = math.floor(bounds.y / cellSize) * cellSize
  for x = x0, bounds.x + bounds.w + cellSize, cellSize do
    love.graphics.line(x, bounds.y, x, bounds.y + bounds.h)
  end
  for y = y0, bounds.y + bounds.h + cellSize, cellSize do
    love.graphics.line(bounds.x, y, bounds.x + bounds.w, y)
  end
  love.graphics.setLineWidth(1.5)
end

function draw.occupiedCell(rect, count, COLORS)
  local t = math.min(1, count / 6)
  setColor(COLORS.cellFill, 0.08 + t * 0.22)
  love.graphics.rectangle("fill", rect.x, rect.y, rect.w, rect.h)
  setColor(COLORS.cellEdge, 0.25 + t * 0.45)
  love.graphics.setLineWidth(1)
  love.graphics.rectangle("line", rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1)
  if count > 1 then
    setColor(COLORS.muted, 0.7)
    love.graphics.print(tostring(count), rect.x + 4, rect.y + 2)
  end
  love.graphics.setLineWidth(1.5)
end

function draw.body(body, COLORS, opts)
  opts = opts or {}
  local colliding = opts.colliding
  local selected = opts.selected
  local isAabb = body:isAabb()

  local fill
  if colliding then
    fill = { COLORS.hit[1], COLORS.hit[2], COLORS.hit[3], 0.45 }
  elseif isAabb then
    fill = { 0.25, 0.45, 0.75, 0.42 }
  else
    fill = { 0.85, 0.50, 0.25, 0.42 }
  end

  local edge = colliding and COLORS.hit or (isAabb and COLORS.projA or COLORS.projB)
  if selected then
    edge = COLORS.accent
  end

  setColor(fill)
  if body:isCircle() then
    love.graphics.circle("fill", body.x, body.y, body.r)
    setColor(edge)
    love.graphics.setLineWidth(selected and 2.5 or 1.5)
    love.graphics.circle("line", body.x, body.y, body.r)
  else
    local a = body:aabb()
    love.graphics.rectangle("fill", a.minX, a.minY, a.maxX - a.minX, a.maxY - a.minY)
    setColor(edge)
    love.graphics.setLineWidth(selected and 2.5 or 1.5)
    love.graphics.rectangle("line", a.minX, a.minY, a.maxX - a.minX, a.maxY - a.minY)
  end

  -- Always show AABB proxy for circles when requested
  if opts.showProxy and body:isCircle() then
    local a = body:aabb()
    setColor(COLORS.proxy, 0.55)
    love.graphics.setLineWidth(1)
    love.graphics.rectangle("line", a.minX, a.minY, a.maxX - a.minX, a.maxY - a.minY)
  end

  setColor(COLORS.text, 0.85)
  love.graphics.circle("fill", body.x, body.y, 2.5)
  if body.label and body.label ~= "" then
    love.graphics.print(body.label, body.x + 5, body.y - 14)
  end
  love.graphics.setLineWidth(1.5)
end

function draw.pairLine(ax, ay, bx, by, color, alpha)
  setColor(color, alpha or 0.55)
  love.graphics.setLineWidth(1.25)
  love.graphics.line(ax, ay, bx, by)
  love.graphics.setLineWidth(1.5)
end

function draw.legendSwatch(x, y, color, label, COLORS)
  setColor(color)
  love.graphics.rectangle("fill", x, y, 12, 12)
  setColor(COLORS.text)
  love.graphics.print(label, x + 18, y - 1)
end

return draw
