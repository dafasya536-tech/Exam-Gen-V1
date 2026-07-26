function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Exam Generator')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1') // <--- BARIS SAKTI INI YANG DITAMBAHKAN
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function prosesBuatForm(data) {
  var mapelNama = data.mapel ? data.mapel.trim() : "Umum";
  var namaFolder = "Kumpulan soal " + mapelNama;
  
  // 1. CARI ATAU BUAT FOLDER DI GOOGLE DRIVE
  var targetFolder;
  var folders = DriveApp.getFoldersByName(namaFolder);
  if (folders.hasNext()) {
    targetFolder = folders.next();
  } else {
    targetFolder = DriveApp.createFolder(namaFolder);
  }

  // 2. BUAT GOOGLE FORM
  var judulLengkap = "[" + mapelNama.toUpperCase() + "] " + data.judulForm;
  var form = FormApp.create(judulLengkap);
  form.setIsQuiz(true); // Aktifkan mode kuis
  form.setProgressBar(true); // Tampilkan bilah progres
  form.setShuffleQuestions(true); // FITUR ACAK SOAL DIAKTIFKAN

  // Pindahkan file ke folder Mapel (Menggunakan moveTo agar tidak error permission)
  var fileForm = DriveApp.getFileById(form.getId());
  fileForm.moveTo(targetFolder);

  // 3. PROSES DATA SISWA & PERCABANGAN KELAS
  var barisSiswa = data.siswaText.split('\n');
  var dataSiswaMap = {}; 

  for (var i = 0; i < barisSiswa.length; i++) {
    var line = barisSiswa[i].trim();
    if (line !== '') {
      var parts = line.split(/[\t,]+/); 
      if (parts.length >= 2) {
        var nama = parts[0].trim();
        var kelas = parts[1].trim();
        if (!dataSiswaMap[kelas]) dataSiswaMap[kelas] = [];
        dataSiswaMap[kelas].push(nama);
      }
    }
  }

  var halamanKelasMap = {};
  if (Object.keys(dataSiswaMap).length > 0) {
    var itemKelas = form.addListItem().setTitle('Pilih Kelas Anda').setRequired(true);
    var pilihanKelas = [];

    for (var kelas in dataSiswaMap) {
      var page = form.addPageBreakItem().setTitle('Data Diri - Kelas ' + kelas);
      halamanKelasMap[kelas] = page;
      var itemNama = form.addListItem().setTitle('Pilih Nama Anda').setRequired(true);
      itemNama.setChoiceValues(dataSiswaMap[kelas]);
      pilihanKelas.push(itemKelas.createChoice(kelas, page));
    }
    itemKelas.setChoices(pilihanKelas);
  }

  // 4. PARSER SOAL: KUMPULKAN DAN KELOMPOKKAN SOAL
  var teksSoal = data.soalText.split('\n');
  var listSemuaSoal = [];
  var soalTemp = null;
  var wacanaAktif = '';
  var isWacanaBaru = false;

  for (var j = 0; j < teksSoal.length; j++) {
    var baris = teksSoal[j].trim();
    if (baris === '') continue;

    if (baris.startsWith('[TEKS]')) {
      wacanaAktif = baris.replace('[TEKS]', '').trim();
      isWacanaBaru = true; // Tandai bahwa ada teks bacaan baru
      continue;
    }

    if (baris.startsWith('[PG]') || baris.startsWith('[DROP]') || baris.startsWith('[MATCH]') || baris.startsWith('[SA]')) {
      if (soalTemp) listSemuaSoal.push(soalTemp);
      
      var jenisBaru = baris.substring(1, baris.indexOf(']'));
      var tanyaBaru = baris.substring(baris.indexOf(']') + 1).trim();
      
      soalTemp = {
        jenis: jenisBaru,
        tanya: tanyaBaru,
        wacana: isWacanaBaru ? wacanaAktif : null, // Wacana hanya ditempel ke soal pertama setelah tag [TEKS]
        opsi: [],
        kunci: '',
        mBaris: [],
        mKolom: [],
        mode: ''
      };
      isWacanaBaru = false; // Reset agar soal berikutnya tidak membuat section wacana baru lagi
    } 
    else if (soalTemp) {
      if (baris.startsWith('A.') || baris.startsWith('B.') || baris.startsWith('C.') || baris.startsWith('D.') || baris.startsWith('E.')) {
        soalTemp.opsi.push(baris.substring(2).trim());
      } 
      else if (baris.startsWith('Kunci:')) {
        soalTemp.kunci = baris.replace('Kunci:', '').trim();
      } 
      else if (soalTemp.jenis === 'MATCH') {
        if (baris.toUpperCase().includes('BARIS:')) {
          soalTemp.mode = 'BARIS';
        } else if (baris.toUpperCase().includes('KOLOM:')) {
          soalTemp.mode = 'KOLOM';
        } else if (baris.startsWith('-')) {
          var itemVal = baris.replace('-', '').trim();
          if (soalTemp.mode === 'BARIS') soalTemp.mBaris.push(itemVal);
          else if (soalTemp.mode === 'KOLOM') soalTemp.mKolom.push(itemVal);
        }
      }
    }
  }
  if (soalTemp) listSemuaSoal.push(soalTemp);

  // 5. BUAT SECTION PER JENIS SOAL & MASUKKAN POIN
  var namaBagian = {
    'PG': 'Pilihan Ganda',
    'DROP': 'Dropdown',
    'MATCH': 'Menjodohkan',
    'SA': 'Jawaban Singkat'
  };

  var poinTipe = {
    'PG': Number(data.poinPG) || 0,
    'DROP': Number(data.poinDROP) || 0,
    'MATCH': Number(data.poinMATCH) || 0,
    'SA': Number(data.poinSA) || 0
  };

  var filterAktif = data.filterModel || [];
  var halamanPertamaSoal = null;

  for (var idx = 0; idx < filterAktif.length; idx++) {
    var tipe = filterAktif[idx];
    var soalTipeIni = listSemuaSoal.filter(function(s) { return s.jenis === tipe; });

    if (soalTipeIni.length > 0) {
      var judulSection = (halamanPertamaSoal === null) 
                         ? ('Soal Ujian: ' + mapelNama + ' - ' + namaBagian[tipe]) 
                         : ('Bagian: ' + namaBagian[tipe]);
                         
      var section = form.addPageBreakItem().setTitle(judulSection);
      if (halamanPertamaSoal === null) halamanPertamaSoal = section;

      var poinUntukSoalIni = poinTipe[tipe];

      for (var s = 0; s < soalTipeIni.length; s++) {
        var d = soalTipeIni[s];
        
        // JIKA ADA WACANA, BUAT HALAMAN BARU KHUSUS WACANA INI
        if (d.wacana) {
          form.addPageBreakItem().setTitle('Teks Wacana / Bacaan').setHelpText(d.wacana);
        }
        
        simpanSoalKeForm(form, d, poinUntukSoalIni);
      }
    }
  }

  // 6. ARAHKAN KELAS KE SECTION SOAL PERTAMA
  if (Object.keys(dataSiswaMap).length > 0 && halamanPertamaSoal) {
    for (var k in halamanKelasMap) {
      halamanKelasMap[k].setGoToPage(halamanPertamaSoal);
    }
  }

  return form.getEditUrl();
}

function simpanSoalKeForm(form, dataSoal, poin) {
  if (!dataSoal.tanya) return;

  if (dataSoal.jenis === 'PG' || dataSoal.jenis === 'DROP') {
    var item = dataSoal.jenis === 'PG' ? form.addMultipleChoiceItem() : form.addListItem();
    item.setTitle(dataSoal.tanya).setPoints(poin).setRequired(true);
    
    var choices = [];
    var kunciBersih = (dataSoal.kunci || '').toString().trim().toUpperCase();

    for (var i = 0; i < dataSoal.opsi.length; i++) {
      var huruf = String.fromCharCode(65 + i); 
      var teksOpsiBersih = dataSoal.opsi[i].trim().toUpperCase();
      
      // Deteksi valid jika yang ditulis guru adalah Huruf (A) atau teks persis opsinya
      var isTrue = (huruf === kunciBersih || teksOpsiBersih === kunciBersih);
      choices.push(item.createChoice(dataSoal.opsi[i], isTrue));
    }
    item.setChoices(choices);
  } 
  else if (dataSoal.jenis === 'MATCH') {
    if (dataSoal.mBaris.length > 0 && dataSoal.mKolom.length > 0) {
      var item = form.addGridItem().setTitle(dataSoal.tanya).setRequired(true);
      item.setRows(dataSoal.mBaris).setColumns(dataSoal.mKolom);
    }
  } 
  else if (dataSoal.jenis === 'SA') {
    form.addTextItem().setTitle(dataSoal.tanya).setPoints(poin).setRequired(true);
  }
}
