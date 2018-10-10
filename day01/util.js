 /**
     * 相关参考链接
     * http://lbsyun.baidu.com/index.php?title=jspopular/guide/usage
     * http://lbsyun.baidu.com/index.php?title=jspopular3.0/guide/geolocation
    */
   function jsonP(url) {
    let script = document.createElement("script");
    script.src = url;
    document.body.insertBefore(script, document.body.firstChild);
    document.body.removeChild(script);
  }
  function getCity() {
    function getCurrentCity(result) {
      //去掉城市名后的"市"
      var cityName = result.name.substring(0, result.name.length - 1);
      console.log('city: ', cityName);
      document.getElementById("currentCity").innerText=cityName;
      //请求当前城市的天气数据
      jsonP(createUrl(cityName,true));
      jsonP(createUrl(cityName));
    }
    var cityName = new BMap.LocalCity();
    cityName.get(getCurrentCity);
  }
  function createUrl(cityName,isToday=false) {
    if (!cityName) {
      cityName = document.getElementById('city').value;
    }
    let todayUrl= 'https://api.map.baidu.com/telematics/v3/weather?output=json&ak=FK9mkfdQsloEngodbFl4FeY3&callback=getTodayWeather&location=' + encodeURI(cityName);

    let allUrl='https://sapi.k780.com/?app=weather.future&appkey=10003&sign=b59bc3ef6191eb9f747dd4e83c99f2a4&format=json&jsoncallback=getWeather&weaid=' + encodeURI(cityName);
   
    return isToday?todayUrl:allUrl;
  }