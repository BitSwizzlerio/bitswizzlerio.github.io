--[[
  Overlay MPR step geometry onto the Minkowski viewport.
]]

local drawm = require("narrowphase.draw_minkowski")
local drawc = require("narrowphase.draw_common")

local draw = {}

local function setColor(c, a)
  love.graphics.setColor(c[1], c[2], c[3], a or c[4] or 1)
end

function draw.overlay(step, cam, COLORS)
  if not step then return end

  local v0 = step.v0
  if v0 then
    drawm.point(cam, v0, COLORS.v0, 6, "v0")
    -- Ray v0 -> origin (and a short extension past O)
    local x0, y0 = cam.toScreen(v0.x, v0.y)
    local ox, oy = cam.toScreen(0, 0)
    setColor(COLORS.origin, 0.7)
    love.graphics.setLineWidth(1.5)
    love.graphics.line(x0, y0, ox, oy)
    -- Extend past origin
    local dx, dy = -v0.x, -v0.y
    local l = math.sqrt(dx * dx + dy * dy)
    if l > 1e-9 then
      local ext = 40 / cam.scale
      local ex, ey = cam.toScreen(-dx / l * ext, -dy / l * ext)
      setColor(COLORS.origin, 0.35)
      love.graphics.line(ox, oy, ex, ey)
    end
    love.graphics.setLineWidth(1.5)
  end

  local portal = step.portal
  if portal and #portal >= 1 then
    if #portal >= 2 then
      -- Triangle v0-v1-v2
      if v0 then
        drawm.poly(cam, { v0, portal[1], portal[2] }, COLORS.portalFill, nil)
      end
      drawm.segment(cam, portal[1], portal[2], COLORS.portalEdge, 3)
      drawm.point(cam, portal[1], COLORS.portalEdge, 6, "v1")
      drawm.point(cam, portal[2], COLORS.portalEdge, 6, "v2")
    else
      drawm.point(cam, portal[1], COLORS.portalEdge, 6, "v1")
    end
  end

  if step.normal and (step.normal.x ~= 0 or step.normal.y ~= 0) then
    local base = (portal and portal[1]) or { x = 0, y = 0 }
    if portal and #portal >= 2 then
      base = {
        x = (portal[1].x + portal[2].x) * 0.5,
        y = (portal[1].y + portal[2].y) * 0.5,
      }
    end
    drawm.dirArrow(cam, base.x, base.y, step.normal.x, step.normal.y, COLORS.axis, "n", 55)
  end

  if step.support then
    local col = (step.colliding == false) and COLORS.miss or COLORS.support
    drawm.point(cam, step.support, col, 7, "s")
  end
end

function draw.worldHints(step, result, shapeA, shapeB, COLORS)
  if not step then return end
  if step.support then
    drawc.supportWitnesses(step.support, COLORS)
  end
  -- Draw approximate separation/penetration normal in world space
  if result and result.colliding and result.normal and result.depth and result.depth > 0 then
    local mx = (shapeA.x + shapeB.x) / 2
    local my = (shapeA.y + shapeB.y) / 2
    local nx, ny = result.normal.x, result.normal.y
    local d = result.depth
    drawc.arrow(mx, my, mx + nx * d, my + ny * d, COLORS.hit, 3)
    setColor(COLORS.hit)
    love.graphics.print("~n*depth", mx + nx * d + 6, my + ny * d - 12)
  end
end

return draw
