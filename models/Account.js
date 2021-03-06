module.exports = function(app, config, mongoose, nodemailer) {
  var crypto = require('crypto');
  var gravatar = require('gravatar');
  var util = require('util');
  var Schema = mongoose.Schema
      , _ = require('underscore')
      , mongooseRedisCache = require("mongoose-redis-cache");

  var Status = new mongoose.Schema({
    name: {
      first:   { type: String },
      last:    { type: String }
    },
    status:    { type: String }
  });

  var schemaOptions = {
    toJSON: {
      virtuals: true	
    },
    toObject: {
      virtuals: true
    }
  };

  var AccountSchema = new mongoose.Schema({
    email:     { type: String, lowercase: true, unique: true, required: true, trim: true },
    password:  { type: String, select: false },
    photoUrl:  { type: String },
    name: { type: String, lowercase: true, unique: true, default: '', trim: true },
    country: { type: String},
    subscribes: [{type: Schema.ObjectId, ref: 'Channel'}],
    uuid: { type: String, select: false },
    settings: {
      privacy: {type: Boolean, default: false}
    } 
      
    // name: {
    //   first:   { type: String },
    //   last:    { type: String },
    //   full:    { type: String }
    // },
    // birthday: {
    //   day:     { type: Number, min: 1, max: 31, required: false },
    //   month:   { type: Number, min: 1, max: 12, required: false },
    //   year:    { type: Number }
    // },
    //biography: { type: String },
    //contacts:  [Contact],
    //status:    [Status], // My own status updates only
    //activity:  [Status]  //  All status updates including friends
  },{safe: true});

  var Account = mongoose.model('Account', AccountSchema);

  var changePassword = function(accountId, newpassword) {
    var shaSum = crypto.createHash('sha256');
    shaSum.update(newpassword);
    var hashedPassword = shaSum.digest('hex');
    Account.update({_id:accountId}, {$set: {password:hashedPassword}},{upsert:false},
      function changePasswordCallback(err) {
        console.log('Change password done for account ' + accountId);
    });
  };

  var forgotPassword = function(email, resetPasswordUrl, callback) {
    var user = Account.findOne({email: email}, function findAccount(err, doc){
      if (err) {
        // Email address is not a valid user
        callback(false);
      } else {
        var smtpTransport = nodemailer.createTransport('SMTP', config.mail);
        resetPasswordUrl += '?account=' + doc._id;
        smtpTransport.sendMail({
          from: 'thisapp@example.com',
          to: doc.email,
          subject: 'SocialNet Password Request',
          text: 'Click here to reset your password: ' + resetPasswordUrl
        }, function forgotPasswordResult(err) {
          if (err) {
            callback(false);
          } else {
            callback(true);
          }
        });
      }
    });
  };

  var login = function(email, password, callback) {
    console.log(" In account login");
    var shaSum = crypto.createHash('sha256');
    shaSum.update(password);
    Account.findOne({email:email,password:shaSum.digest('hex')},function(err,account){
      return callback(err,account);
    });

  };

  var findByString = function(searchStr, callback) {
    var searchRegex = new RegExp(searchStr, 'i');
    Account.find({
      $or: [
        { 'name.full': { $regex: searchRegex } },
        { email:       { $regex: searchRegex } }
      ]
    }, function(err,doc){ callback(err,doc);});
  };

  var findById = function(accountId, callback) {
    Account.findOne({_id:accountId}, function(err,doc) {
      console.log("doc: " + doc);
      callback(err,doc);
    });
  };

  var addContact = function(account, addcontact) {
    contact = {
      name: addcontact.name,
      accountId: addcontact._id,
      added: new Date(),
      updated: new Date()
    };
    account.contacts.push(contact);

    account.save(function (err) {
      if (err) {
        console.log('Error saving account: ' + err);
      }
    });
  };

  var removeContact = function(account, contactId) {
    if ( null == account.contacts ) return;

    account.contacts.forEach(function(contact) {
      if ( contact.accountId == contactId ) {
        account.contacts.remove(contact);
      }
    });
    account.save();
  };

  var hasContact = function(account, contactId) {
    if ( null == account.contacts ) return false;

    account.contacts.forEach(function(contact) {
      if ( contact.accountId == contactId ) {
        return true;
      }
    });
    return false;
  };

  var findOrRegister = function(userObj, callback){
    console.log(userObj.name);
    Account.findOne({email: userObj.email}).exec(function(err, user){
      if(err){ res.send(400); }
      if(!user){  // User not exist in our database
        var account = new Account({
            email: userObj.email,
            name: userObj.name,
            photoUrl: userObj.photo
        });
        account.save(function(err){
          callback(err, account);
        });
      }
      else{ // User exist
        callback(null,user);
      }
    });
  };

  var localRegister = function(email, password, name, callback) {
    var password;
    if( password){
      shaSum = crypto.createHash('sha256');
      shaSum.update(password);
      password = shaSum.digest('hex');
    }
    else{
      return console.log("no password error");
    }

    console.log('Registering ' + email);
    var user = new Account({
      email: email,
      name: name,
      password: password,
      photoUrl: gravatar.url(email, {s: '200', d: 'retro'})
    });
    user.save(function(err){
          callback(err, user);
    });
    

  };

  var addSubscribe = function(userId, channel){
    Account.findOne({_id: userId}).exec(function(err, account){
      account.subscribes.push(channel);
    });
  };

  var removeSubscribe = function(userId, channel){
    Account.findOne({_id: userId}).exec(function(err, account){
      index = account.subscribes.indexOf(channel);
      account.subscribes.splice(index,index);
    });
  };

  app.get('/account', app.ensureAuthenticated, function(req, res){
    Account.findOne({_id: req.user._id}).populate('subscribes').exec(function(err, doc){
      if( err ){
        res.send({
          'success': false,
          'error': err
        })
      }
      else{
        res.send(doc)
      }
    })
  });
  
  app.get('/account/profile/:id', function(req, res){
    Account.findOne({_id: req.params.id}).populate('subscribes').exec(function(err, doc){
      if( err ){
        res.send({
          'success': false,
          'error': err
        })
      }
      else{
        if( !doc.settings.privacy ||  (req.user && doc._id == req.user.id) )
          res.send(doc)
        else{
          res.send({
            name: doc.name,
            photoUrl: doc.photoUrl
          })
        }
      }
    })
  });

  app.get('/account/create', function(req, res){
    res.render('createAccount');
  });

  app.post('/account', function(req, res){

    req.params = req.body;
    console.log(req.body);

    req.assert('email', 'required').notEmpty();
    req.assert('email', 'valid email required').isEmail();
    req.assert('password', '6 to 20 characters required').len(6, 20);

    var errors = req.validationErrors();
    if (errors) {
      res.send('There have been validation errors: ' + util.inspect(errors), 500);
      return;
    }

    localRegister(req.body.email, req.body.password, req.body.name , function(err, account){
      if(err) res.status(200).send({'success':false,'error':'Unexpected error, maybe duplicated name or email'})
      else{
        req.logIn(account, function(err){
          if(err) res.send({"success":false, 'error': err})
          else{
            //res.status(200).send({'success':true})
            //res.redirect('/account')
            res.send({'success': true});
          }
        })
        
      }
    });
  });

  // add subscribe
  app.post('/account/subscribe/:cid', app.ensureAuthenticated, function(req, res){ 
    Account.findOneAndUpdate({_id: req.user._id, subscribes: { $ne: req.params.cid }}, {$push: {subscribes: req.params.cid} }) 
    .exec(function(err, doc){
      if(err){
        res.send({'success': false, 'error': err });
      }else{
        if(doc) 
          res.send({'success': true});
        else
          res.send({'success': false, 'error': 'Already existed'})
      }
    });
    
  });
  
  // remove subscribe
  app.delete('/account/subscribe/:cid', app.ensureAuthenticated, function(req, res){
    Account.findOne({_id: req.user._id}).exec(function(err, acc){
      if( acc.subscribes.indexOf(req.params.cid) == -1 ){
        res.send({'success': false, 'error': 'Channel not subscribed' })
      }
      else{
        index = acc.subscribes.indexOf(req.params.cid);
        acc.subscribes.splice(index,index+1);
        acc.save(function(err, doc){
          if(err || !doc) res.send({'success': false, 'error': err })
          else
            res.send({'success': true});
        });
        
      }
    });
  });
  
  // check subscribe
  app.get('/account/subscribe/:cid', app.ensureAuthenticated, function(req, res){
    Account.findOne({_id: req.user._id}).exec(function(err, acc){
      if( acc.subscribes.indexOf(req.params.cid) == -1 ){
        res.send({'success': false});
      }else{
        res.send({'success': true});
      }
    });
  });
  
  app.post('/account/settings', app.ensureAuthenticated, function(req, res){
    Account.findOne({_id: req.user._id}).exec(function(err, acc){
      if(err) res.send({'success': false, 'error': err })
      else{
        acc.settings = _.extend(acc.settings, req.body)
        acc.save(function(err){
          if(err) res.send({'success': false, 'error': err })
          else{
            res.send({'success':true})
          }
        })
      }
    })
  });
  
  return {
    findById: findById,
    register: localRegister,
    hasContact: hasContact,
    forgotPassword: forgotPassword,
    changePassword: changePassword,
    findByString: findByString,
    addContact: addContact,
    removeContact: removeContact,
    login: login,
    Account: Account,
    findOrRegister: findOrRegister
  }
}
