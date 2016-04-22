  // init controller
  var controller = new ScrollMagic.Controller();

  // build scene
  var scene = new ScrollMagic.Scene({triggerElement: "#trigger"})
          // trigger a velocity opaticy animation
          .setVelocity("#foo", {opacity: 0}, {duration: 400})
          .addTo(controller);
