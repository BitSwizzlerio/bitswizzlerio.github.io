function love.conf(t)
  t.identity = "CollisionLab"
  t.window.title = "CollisionLab - Narrowphase / Broadphase"
  t.window.width = 1280
  t.window.height = 780
  -- Resizable from creation: in the browser build this is what makes the canvas render at the size
  -- of its CSS box (and follow it on rotation) instead of a fixed 1280x780 the browser shrinks.
  t.window.resizable = true
  t.window.minwidth = 320
  t.window.minheight = 300
  t.window.vsync = 1
  t.modules.joystick = false
  t.modules.physics = false
  t.modules.video = false
end
