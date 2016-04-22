  // define images
  var images = [
    "./portrait_web.jpg",
    "./img/frame_1_delay-0.05s.gif",
    "./img/frame_2_delay-0.05s.gif",
    "./img/frame_3_delay-0.05s.gif",
    "./img/frame_4_delay-0.05s.gif",
    "./img/frame_5_delay-0.05s.gif",
    "./img/frame_6_delay-0.05s.gif",
    "./img/frame_7_delay-0.05s.gif",
    "./img/frame_8_delay-0.05s.gif",
    "./img/frame_9_delay-0.05s.gif",
    "./img/frame_10_delay-0.05s.gif",
    "./img/frame_11_delay-0.05s.gif",
    "./img/frame_12_delay-0.05s.gif",
    "./img/frame_13_delay-0.05s.gif",
    "./img/frame_14_delay-0.05s.gif",
    "./img/frame_15_delay-0.05s.gif",
    "./img/frame_16_delay-0.05s.gif",
    "./img/frame_17_delay-0.05s.gif",
    "./img/frame_18_delay-0.05s.gif",
    "./img/frame_19_delay-0.05s.gif",
    "./img/frame_20_delay-0.05s.gif",
    "./img/frame_21_delay-0.05s.gif",
    "./img/frame_22_delay-0.05s.gif",
    "./img/frame_23_delay-0.05s.gif",
    "./img/frame_24_delay-0.05s.gif",
    "./img/frame_25_delay-0.05s.gif",
    "./img/frame_26_delay-0.05s.gif",
    "./img/frame_27_delay-0.05s.gif",
    "./img/frame_28_delay-0.05s.gif",
    "./img/frame_29_delay-0.05s.gif",
    "./img/frame_30_delay-0.05s.gif",
    "./img/frame_31_delay-0.05s.gif",
    "./img/frame_32_delay-0.05s.gif",
    "./img/frame_33_delay-0.05s.gif",
    "./img/frame_34_delay-0.05s.gif",
    "./img/frame_35_delay-0.05s.gif",
    "./img/frame_36_delay-0.05s.gif",
    "./img/frame_37_delay-0.05s.gif",
    "./img/frame_38_delay-0.05s.gif",
    "./img/frame_39_delay-0.05s.gif",

  ];

  // TweenMax can tween any property of any object. We use this object to cycle through the array
  var obj = {curImg: 0};

  // create tween
  var tween = TweenMax.to(obj, 0.5,
    {
      curImg: images.length - 1,  // animate propery curImg to number of images
      roundProps: "curImg",       // only integers so it can be used as an array index
      repeat: 0,                  // repeat 3 times
      immediateRender: true,      // load first image automatically
      ease: Linear.easeNone,      // show every image the same ammount of time
      onUpdate: function () {
        $("#myimg").attr("src", images[obj.curImg]); // set the image source
      }
    }
  );

  // init controller
  var controller = new ScrollMagic.Controller();

  // build scene
  var scene = new ScrollMagic.Scene({triggerElement: "#trigger", duration: 200})
          .setTween(tween)
          // .addIndicators() // add indicators (requires plugin)
          .addTo(controller);

  // handle form change
  $("form.move input[name=duration]:radio").change(function () {
    scene.duration($(this).val());
  });
