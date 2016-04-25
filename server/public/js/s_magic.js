  // init controller
  var controller = new ScrollMagic.Controller();

  // build scene
  var scene = new ScrollMagic.Scene({triggerElement: "#trigger"})
          // trigger a velocity opaticy animation
          .setVelocity("#foo", {color: "#F0FFFF"}, {duration: 400})
          .addTo(controller);
