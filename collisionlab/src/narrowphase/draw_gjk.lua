--[[
  Overlay GJK step geometry onto the Minkowski viewport.
]]

local drawm = require("narrowphase.draw_minkowski")
local drawc = require("narrowphase.draw_common")

local draw = {}

function draw.overlay(step, cam, COLORS)
  if not step then return end

  local simp = step.simplex or {}

  -- Simplex fill / edges
  if #simp >= 3 then
    drawm.poly(cam, simp, COLORS.simplexFill, COLORS.simplexEdge)
  elseif #simp == 2 then
    drawm.segment(cam, simp[1], simp[2], COLORS.simplexEdge, 3)
  end

  for i, p in ipairs(simp) do
    local label = "A"
    if #simp == 3 then
      label = ({ "C", "B", "A" })[i]
    elseif #simp == 2 then
      label = ({ "B", "A" })[i]
    end
    drawm.point(cam, p, COLORS.simplexEdge, 6, label)
  end

  -- Search direction drawn from the origin
  if step.dir and (step.dir.x ~= 0 or step.dir.y ~= 0) then
    drawm.dirArrow(cam, 0, 0, step.dir.x, step.dir.y, COLORS.axis, "d", 70)
  end

  -- Current support point
  if step.support then
    local col = step.passedOrigin == false and COLORS.miss or COLORS.support
    drawm.point(cam, step.support, col, 7, "s")
    drawm.segment(cam, { x = 0, y = 0 }, step.support, { col[1], col[2], col[3], 0.35 }, 1)
  end
end

function draw.worldHints(step, _shapeA, _shapeB, COLORS)
  if not step or not step.support then return end
  drawc.supportWitnesses(step.support, COLORS)
end

return draw
