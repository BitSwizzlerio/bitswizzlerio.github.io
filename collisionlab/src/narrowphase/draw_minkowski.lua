--[[
  Draw Minkowski difference C = A - B in a viewport rectangle.
  Overlays algorithm-specific geometry (simplex / portal) via callbacks.
]]

local minkowski = require("narrowphase.minkowski")
local drawc = require("narrowphase.draw_common")

local draw = {}

local function setColor(c, a)
  love.graphics.setColor(c[1], c[2], c[3], a or c[4] or 1)
end

--- Draw C outline, origin, axes, and optional overlay(cam, COLORS).
function draw.viewport(shapeA, shapeB, rect, COLORS, overlay)
  local x, y, w, h = rect.x, rect.y, rect.w, rect.h

  -- Background
  setColor(COLORS.minkBg)
  love.graphics.rectangle("fill", x, y, w, h)
  setColor(COLORS.muted, 0.5)
  love.graphics.rectangle("line", x, y, w, h)

  local pts = minkowski.sample(shapeA, shapeB, 72)
  local cam = minkowski.camera(pts, x, y, w, h, 36)

  drawc.withScissor(x, y, w, h, function()
    -- Grid-ish axes through origin
    local ox, oy = cam.toScreen(0, 0)
    setColor(COLORS.muted, 0.35)
    love.graphics.setLineWidth(1)
    love.graphics.line(x, oy, x + w, oy)
    love.graphics.line(ox, y, ox, y + h)

    -- C polygon
    if #pts >= 3 then
      local flat = {}
      for _, p in ipairs(pts) do
        local sx, sy = cam.toScreen(p.x, p.y)
        flat[#flat + 1] = sx
        flat[#flat + 1] = sy
      end
      setColor(COLORS.minkFill)
      love.graphics.polygon("fill", flat)
      setColor(COLORS.minkEdge)
      love.graphics.setLineWidth(2)
      love.graphics.polygon("line", flat)
    end

    -- Origin
    drawc.crosshair(ox, oy, 12, COLORS.origin)
    setColor(COLORS.origin)
    love.graphics.print("O", ox + 8, oy - 18)

    if overlay then
      overlay(cam, COLORS)
    end
  end)

  -- Title (ASCII only: default Love font has no special math glyphs)
  setColor(COLORS.text)
  love.graphics.print("Minkowski difference  C = A - B", x + 10, y + 8)
  setColor(COLORS.muted)
  love.graphics.print("Contains origin  <=>  shapes collide", x + 10, y + 26)

  return cam, pts
end

--- Draw a direction arrow from a point in cam/Minkowski space.
--- scaleMul is approximate length in screen pixels.
function draw.dirArrow(cam, ox, oy, dx, dy, color, label, scaleMul)
  scaleMul = scaleMul or 50
  local l = math.sqrt(dx * dx + dy * dy)
  if l < 1e-9 then return end
  dx, dy = dx / l, dy / l
  local x1, y1 = cam.toScreen(ox, oy)
  local worldLen = scaleMul / math.max(cam.scale, 1e-9)
  local x2, y2 = cam.toScreen(ox + dx * worldLen, oy + dy * worldLen)
  drawc.arrow(x1, y1, x2, y2, color, 2)
  if label then
    setColor(color)
    love.graphics.print(label, x2 + 4, y2 - 12)
  end
end

function draw.point(cam, p, color, r, label)
  if not p then return end
  local sx, sy = cam.toScreen(p.x, p.y)
  setColor(color)
  love.graphics.circle("fill", sx, sy, r or 5)
  if label then
    love.graphics.print(label, sx + 6, sy - 14)
  end
end

function draw.segment(cam, a, b, color, width)
  if not a or not b then return end
  local x1, y1 = cam.toScreen(a.x, a.y)
  local x2, y2 = cam.toScreen(b.x, b.y)
  setColor(color)
  love.graphics.setLineWidth(width or 2)
  love.graphics.line(x1, y1, x2, y2)
  love.graphics.setLineWidth(1.5)
end

function draw.poly(cam, pts, fill, edge)
  if not pts or #pts < 2 then return end
  local flat = {}
  for _, p in ipairs(pts) do
    local sx, sy = cam.toScreen(p.x, p.y)
    flat[#flat + 1] = sx
    flat[#flat + 1] = sy
  end
  if #pts >= 3 and fill then
    setColor(fill)
    love.graphics.polygon("fill", flat)
  end
  if edge then
    setColor(edge)
    love.graphics.setLineWidth(2.5)
    if #pts >= 3 then
      love.graphics.polygon("line", flat)
    elseif #pts == 2 then
      love.graphics.line(flat[1], flat[2], flat[3], flat[4])
    end
    love.graphics.setLineWidth(1.5)
  end
end

return draw
